variable "name" {
  description = "Resource name prefix, e.g. tradingvue-staging."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the DB subnet group."
  type        = list(string)
}

variable "db_security_group_id" {
  description = "Security group allowing Postgres from the API."
  type        = string
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Allocated storage in GiB."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "tradingvue"
}

variable "db_username" {
  description = "Master username."
  type        = string
  default     = "tradingvue"
}

variable "multi_az" {
  description = "Whether to run the DB Multi-AZ (recommended for production)."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Protect the DB from accidental deletion."
  type        = bool
  default     = false
}

variable "backup_retention_period" {
  description = "Automated backup retention in days (0 disables; free-tier accounts cap this)."
  type        = number
  default     = 7
}
