variable "name" {
  description = "Resource name prefix, e.g. tradingvue-staging."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread subnets across."
  type        = number
  default     = 2
}

variable "container_port" {
  description = "Port the API container listens on."
  type        = number
  default     = 8080
}
