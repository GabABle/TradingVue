#!/usr/bin/env bash
# Registers a fresh revision of the migrate task definition pointing at the new
# image, runs it once in the private subnets, waits for it to stop, and fails
# the deploy if the migration container exited non-zero.
set -euo pipefail

CLUSTER="$1"
MIGRATE_FAMILY="$2"
IMAGE="$3"
SUBNETS="$4"        # comma-separated subnet ids
SECURITY_GROUP="$5"

echo "Registering migrate task revision with image: $IMAGE"
NEW_DEF=$(aws ecs describe-task-definition --task-definition "$MIGRATE_FAMILY" \
  --query 'taskDefinition' --output json \
  | jq --arg IMG "$IMAGE" '
      .containerDefinitions[0].image = $IMG
      | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions,
         requiresCompatibilities, cpu, memory}')

TASKDEF_ARN=$(aws ecs register-task-definition --cli-input-json "$NEW_DEF" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
echo "Registered: $TASKDEF_ARN"

TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASKDEF_ARN" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "Started migration task: $TASK_ARN"

aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)
REASON=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].stoppedReason' --output text)
echo "Migration exited with code: $EXIT_CODE ($REASON)"

if [ "$EXIT_CODE" != "0" ]; then
  echo "Database migration failed." >&2
  exit 1
fi
echo "Database migration succeeded."
