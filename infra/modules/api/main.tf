data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Application secrets (JWT + third-party API keys).
# JWT_SECRET is generated. The external API keys start blank so the task still
# boots; fill them in Secrets Manager and redeploy to enable those features.
# ---------------------------------------------------------------------------
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.name}/app"
  description = "Application secrets for ${var.name}."
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    JWT_SECRET            = random_password.jwt.result
    ALPACA_API_KEY_ID     = ""
    ALPACA_API_SECRET_KEY = ""
    OPENAI_API_KEY        = ""
    RESEND_API_KEY        = ""
  })

  # CI/operators may rotate individual keys out-of-band; don't fight them.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# IAM roles
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "assume_tasks" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.assume_tasks.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow the execution role to pull the two secrets into the container env.
data "aws_iam_policy_document" "secrets_read" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn, var.database_url_secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets-read"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.secrets_read.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume_tasks.json
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${var.name}/migrate"
  retention_in_days = 30
}

# ---------------------------------------------------------------------------
# ECS cluster + task definitions
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

locals {
  image = "${var.ecr_repository_url}:${var.image_tag}"

  common_secrets = [
    { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
    { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:JWT_SECRET::" },
    { name = "ALPACA_API_KEY_ID", valueFrom = "${aws_secretsmanager_secret.app.arn}:ALPACA_API_KEY_ID::" },
    { name = "ALPACA_API_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:ALPACA_API_SECRET_KEY::" },
    { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:OPENAI_API_KEY::" },
    { name = "RESEND_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:RESEND_API_KEY::" },
  ]
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = local.image
    essential = true
    portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(var.container_port) },
      # Required at import-time by the Replit OpenAI integration package.
      # Placeholders let the app boot; set a real key to enable AI features.
      { name = "AI_INTEGRATIONS_OPENAI_BASE_URL", value = "https://api.openai.com/v1" },
      { name = "AI_INTEGRATIONS_OPENAI_API_KEY", value = "sk-placeholder-not-configured" },
    ]
    secrets = local.common_secrets
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:${var.container_port}/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])

  # CI deploys new task-def revisions with new image tags; ignore drift here.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

# One-off migration task: runs `drizzle-kit push` then exits.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([{
    name        = "migrate"
    image       = "${var.ecr_repository_url}:migrate-${var.image_tag}"
    essential   = true
    command     = ["pnpm", "--filter", "@workspace/db", "run", "push-force"]
    environment = [{ name = "NODE_ENV", value = "production" }]
    secrets     = [{ name = "DATABASE_URL", valueFrom = var.database_url_secret_arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])

  lifecycle {
    ignore_changes = [container_definitions]
  }
}

# ---------------------------------------------------------------------------
# Application Load Balancer
# ---------------------------------------------------------------------------
resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "api" {
  name        = "${var.name}-api"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ---------------------------------------------------------------------------
# ECS service
# ---------------------------------------------------------------------------
resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.api_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.container_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # CI updates task_definition to new revisions; don't revert on plan.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http]
}
