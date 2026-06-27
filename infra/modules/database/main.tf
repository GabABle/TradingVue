# RDS PostgreSQL in private subnets. The master password is generated and the
# full DATABASE_URL is stored in Secrets Manager for the API task to read.
resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "${var.name}-db" }
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.db_security_group_id]
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period   = var.backup_retention_period
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${var.name}-db-final" : null
  apply_immediately         = true

  tags = { Name = "${var.name}-db" }
}

resource "aws_secretsmanager_secret" "db_url" {
  name        = "${var.name}/database-url"
  description = "PostgreSQL connection string for ${var.name}."
}

resource "aws_secretsmanager_secret_version" "db_url" {
  secret_id = aws_secretsmanager_secret.db_url.id
  secret_string = format(
    "postgres://%s:%s@%s/%s?sslmode=no-verify",
    var.db_username,
    random_password.db.result,
    aws_db_instance.this.endpoint,
    var.db_name,
  )
}
