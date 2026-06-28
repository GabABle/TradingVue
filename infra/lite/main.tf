# ---------------------------------------------------------------------------
# Low-cost single-instance deployment (target: under $20/month).
#
# One small EC2 (t3.micro) runs the whole app via docker-compose:
#   postgres + api + nginx(frontend & /api proxy)
# Fronted by CloudFront for free HTTPS. No NAT gateway, no ALB, no Fargate,
# no RDS — those are what made the production-grade stack expensive.
# ---------------------------------------------------------------------------
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = "tradingvue", Environment = "lite", ManagedBy = "terraform" }
  }
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "ecr_repository_url" {
  name = "/tradingvue/shared/ecr_repository_url"
}

# ---------------------------------------------------------------------------
# Minimal network: 1 VPC, 1 public subnet, IGW. No NAT.
# ---------------------------------------------------------------------------
resource "aws_vpc" "this" {
  cidr_block           = "10.1.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "tradingvue-lite" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "tradingvue-lite" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.1.0.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "tradingvue-lite-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "tradingvue-lite-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Only CloudFront's edge IPs may reach the instance on port 80.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "app" {
  name        = "tradingvue-lite"
  description = "Allow HTTP only from CloudFront."
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "HTTP from CloudFront"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "tradingvue-lite" }
}

# ---------------------------------------------------------------------------
# IAM: instance can pull from ECR and be managed via SSM (no SSH key needed).
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "assume_ec2" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "tradingvue-lite-instance"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "instance" {
  name = "tradingvue-lite-instance"
  role = aws_iam_role.instance.name
}

# Read the app's API keys (Polygon/Alpaca/OpenAI) from SSM Parameter Store.
data "aws_iam_policy_document" "ssm_params" {
  statement {
    sid       = "ReadTradingVueParams"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/tradingvue/*"]
  }
  statement {
    sid       = "DecryptSsmSecureStrings"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ssm_params" {
  name   = "read-app-secrets"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.ssm_params.json
}

# ---------------------------------------------------------------------------
# Secrets (generated; injected via user-data)
# ---------------------------------------------------------------------------
resource "random_password" "db" {
  length  = 24
  special = false
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# The instance
# ---------------------------------------------------------------------------
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  ecr_url    = data.aws_ssm_parameter.ecr_repository_url.value
  ecr_registry = split("/", local.ecr_url)[0]
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    region       = var.aws_region
    ecr_url      = local.ecr_url
    ecr_registry = local.ecr_registry
    db_password  = random_password.db.result
    jwt_secret   = random_password.jwt.result
  })

  # Re-run user-data if the script changes.
  user_data_replace_on_change = true

  tags = { Name = "tradingvue-lite" }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "tradingvue-lite" }
}

# ---------------------------------------------------------------------------
# CloudFront for free HTTPS in front of the instance.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = "tradingvue-lite"
  default_root_object = "index.html"

  origin {
    domain_name = aws_eip.app.public_dns
    origin_id   = "ec2"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "ec2"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Managed CachingDisabled + AllViewer (forward everything to the app).
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "app_url" {
  value = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "instance_public_dns" {
  value = aws_eip.app.public_dns
}

output "instance_id" {
  value = aws_instance.app.id
}
