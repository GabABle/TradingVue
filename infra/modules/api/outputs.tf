output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "api_task_family" {
  value = aws_ecs_task_definition.api.family
}

output "migrate_task_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "app_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}
