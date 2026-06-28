# Partial backend: bucket supplied at init, e.g.
#   terraform init -backend-config="bucket=tradingvue-tfstate-026818611950"
terraform {
  backend "s3" {
    key            = "lite/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "tradingvue-tf-locks"
    encrypt        = true
  }
}
