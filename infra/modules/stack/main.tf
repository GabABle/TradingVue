locals {
  name = "${var.project}-${var.environment}"
}

module "network" {
  source         = "../network"
  name           = local.name
  vpc_cidr       = var.vpc_cidr
  container_port = var.container_port
}

module "database" {
  source               = "../database"
  name                 = local.name
  private_subnet_ids   = module.network.private_subnet_ids
  db_security_group_id = module.network.db_security_group_id
  instance_class       = var.db_instance_class
  multi_az             = var.db_multi_az
  deletion_protection     = var.db_deletion_protection
  backup_retention_period = var.db_backup_retention_period
}

module "api" {
  source                  = "../api"
  name                    = local.name
  environment             = var.environment
  aws_region              = var.aws_region
  vpc_id                  = module.network.vpc_id
  public_subnet_ids       = module.network.public_subnet_ids
  private_subnet_ids      = module.network.private_subnet_ids
  alb_security_group_id   = module.network.alb_security_group_id
  api_security_group_id   = module.network.api_security_group_id
  ecr_repository_url      = var.ecr_repository_url
  container_port          = var.container_port
  desired_count           = var.desired_count
  task_cpu                = var.task_cpu
  task_memory             = var.task_memory
  database_url_secret_arn = module.database.database_url_secret_arn
}

module "frontend" {
  source       = "../frontend"
  name         = local.name
  alb_dns_name = module.api.alb_dns_name
}

# ---------------------------------------------------------------------------
# Publish everything the CI/CD pipeline needs into SSM Parameter Store, so the
# GitHub Actions workflow can discover names/IDs without hard-coding them.
# ---------------------------------------------------------------------------
locals {
  params = {
    ecs_cluster                = module.api.cluster_name
    api_service                = module.api.service_name
    api_task_family            = module.api.api_task_family
    migrate_task_family        = module.api.migrate_task_family
    ecr_repository_url         = var.ecr_repository_url
    frontend_bucket            = module.frontend.bucket_name
    cloudfront_distribution_id = module.frontend.distribution_id
    cloudfront_domain          = module.frontend.domain_name
    private_subnet_ids         = join(",", module.network.private_subnet_ids)
    api_security_group_id      = module.network.api_security_group_id
    container_port             = tostring(var.container_port)
  }
}

resource "aws_ssm_parameter" "deploy" {
  for_each = local.params
  name     = "/${var.project}/${var.environment}/${each.key}"
  type     = "String"
  value    = each.value
}
