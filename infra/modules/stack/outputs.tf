output "app_url" {
  description = "Public HTTPS URL for the environment."
  value       = "https://${module.frontend.domain_name}"
}

output "cloudfront_domain" {
  value = module.frontend.domain_name
}

output "frontend_bucket" {
  value = module.frontend.bucket_name
}

output "cloudfront_distribution_id" {
  value = module.frontend.distribution_id
}

output "ecs_cluster" {
  value = module.api.cluster_name
}

output "api_service" {
  value = module.api.service_name
}

output "db_endpoint" {
  value = module.database.endpoint
}

output "app_secret_arn" {
  description = "Fill third-party API keys here, then redeploy."
  value       = module.api.app_secret_arn
}
