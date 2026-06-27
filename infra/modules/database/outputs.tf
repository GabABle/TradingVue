output "endpoint" {
  value = aws_db_instance.this.endpoint
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN holding the DATABASE_URL string."
  value       = aws_secretsmanager_secret.db_url.arn
}
