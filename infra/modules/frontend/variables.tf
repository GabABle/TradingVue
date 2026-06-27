variable "name" {
  description = "Resource name prefix, e.g. tradingvue-staging."
  type        = string
}

variable "alb_dns_name" {
  description = "ALB DNS name used as the /api/* origin."
  type        = string
}
