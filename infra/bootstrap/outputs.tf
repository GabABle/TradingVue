output "state_bucket" {
  description = "S3 bucket holding remote Terraform state."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "DynamoDB table used for state locking."
  value       = aws_dynamodb_table.locks.name
}

output "ecr_repository_url" {
  description = "URL of the shared ECR repository."
  value       = aws_ecr_repository.app.repository_url
}

output "github_deploy_role_arn" {
  description = "IAM role ARN that GitHub Actions assumes via OIDC."
  value       = aws_iam_role.github_deploy.arn
}
