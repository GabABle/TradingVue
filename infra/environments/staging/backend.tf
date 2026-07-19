# Partial backend: bucket is supplied at init time, e.g.
#   terraform init -backend-config="bucket=<state_bucket_from_bootstrap>"
terraform {
  backend "s3" {
    key            = "staging/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "tradingvue-tf-locks"
    encrypt        = true
  }
}
