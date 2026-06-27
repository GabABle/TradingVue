variable "project" {
  type    = string
  default = "tradingvue"
}

variable "environment" {
  description = "staging | production"
  type        = string
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "ecr_repository_url" {
  description = "Shared ECR repo URL (from the bootstrap stack)."
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_deletion_protection" {
  type    = bool
  default = false
}

variable "db_backup_retention_period" {
  description = "DB automated backup retention in days."
  type        = number
  default     = 7
}
