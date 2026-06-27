terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
    tls    = { source = "hashicorp/tls", version = "~> 4.0" }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "tradingvue"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

data "aws_ssm_parameter" "ecr_repository_url" {
  name = "/tradingvue/shared/ecr_repository_url"
}

module "stack" {
  source             = "../../modules/stack"
  project            = "tradingvue"
  environment        = "production"
  aws_region         = var.aws_region
  ecr_repository_url = data.aws_ssm_parameter.ecr_repository_url.value

  # Sturdier production sizing.
  desired_count          = 2
  task_cpu               = 512
  task_memory            = 1024
  db_instance_class      = "db.t4g.small"
  db_multi_az            = true
  db_deletion_protection     = true
  db_backup_retention_period = 7
}

output "app_url" {
  value = module.stack.app_url
}

output "frontend_bucket" {
  value = module.stack.frontend_bucket
}

output "cloudfront_distribution_id" {
  value = module.stack.cloudfront_distribution_id
}

output "ecs_cluster" {
  value = module.stack.ecs_cluster
}

output "app_secret_arn" {
  value = module.stack.app_secret_arn
}
