variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "ap-southeast-1"
}

variable "project" {
  description = "Project name, used as a prefix for resource names."
  type        = string
  default     = "tradingvue"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform remote state."
  type        = string
}

variable "github_owner" {
  description = "GitHub organisation or user that owns the repository."
  type        = string
  default     = "GabABle"
}

variable "github_repo" {
  description = "GitHub repository name (without owner)."
  type        = string
  default     = "TradingVue"
}
