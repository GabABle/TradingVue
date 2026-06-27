# TradingVue — Operations & Deployment Guide (low-cost "lite" stack)

This is the guide for the environment that is **actually running**: a single
small EC2 instance, fronted by CloudFront, costing roughly $10/month.

---

## 1. What's deployed

| Thing | Value |
|-------|-------|
| Public URL | https://d35buufuexxual.cloudfront.net/ |
| Region | ap-southeast-1 (Singapore) |
| Compute | 1× EC2 `t3.micro` (instance is replaced on infra changes) |
| Runtime | docker-compose on the instance: `db` (Postgres 16) + `api` (Express) + `web` (nginx serving the SPA and proxying `/api`) |
| HTTPS / CDN | CloudFront (default `*.cloudfront.net` cert); the instance security group only accepts traffic from CloudFront |
| Images (ECR `…/tradingvue/app`) | `:bootstrap` (API), `:web` (nginx+frontend), `:migrate-bootstrap` (Drizzle migrations) |
| API keys | SSM Parameter Store `/tradingvue/*` (Polygon, Alpaca key+secret, OpenAI) — fetched at boot by the instance role |
| Terraform state | S3 `tradingvue-tfstate-026818611950`, lock table `tradingvue-tf-locks` |
| IaC location | `infra/lite/` (this folder): `main.tf`, `backend.tf`, `user_data.sh.tftpl`; image build in `docker/web/` |

Cost drivers: the t3.micro (~$8/mo, or free-tier), 20 GB disk (~$1.6), CloudFront
(~$0–1 at low traffic), ECR storage (~$0.2). No NAT gateway, ALB, RDS or Fargate.

---

## 2. App-level bugs that were patched in this deployment

The upstream repo has issues that this deployment works around (worth fixing in
the app itself):

1. **No migration for auth tables.** The repo only migrates `user_portfolio`.
   `users`, `user_watchlists`, `user_preferences`, `user_alerts` are created by
   a `psql` step in `user_data.sh.tftpl`.
2. **DB pool forces SSL.** `api-server/src/lib/db.ts` enables SSL unless the
   `DATABASE_URL` contains "localhost"/"127.0.0.1". The local Postgres has no
   SSL, so the URL carries `?application_name=localhost` to take the non-SSL path.
3. **Required env at import.** The OpenAI integration throws unless
   `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` are set.

The cleanest long-term fix is a small PR to the repo (proper migrations + a less
brittle SSL check). Until then, the workarounds above keep it running.

---

## 3. How to make a change (today's process)

> Note: SSM Agent and EC2 Instance Connect are currently NOT working on the
> instance (likely the `dnf update -y` in user-data disrupting them), so the
> only reliable way to change the running app today is to **replace the
> instance** via Terraform. Fixing that (Section 5) removes most of this pain.

All commands run from **AWS CloudShell** (ap-southeast-1):

```bash
# one-time per CloudShell session
sudo dnf install -y terraform   # via the HashiCorp repo if not present
cd ~/tradingvue-infra/infra/lite
export TF_DATA_DIR=/tmp/tfdata-lite
terraform init -backend-config="bucket=tradingvue-tfstate-026818611950"
```

### a) Change the FRONTEND or API code
The images are built from the public GitHub repo. Rebuild + push, then replace
the instance so it pulls the new image:
```bash
ECR=026818611950.dkr.ecr.ap-southeast-1.amazonaws.com/tradingvue/app
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ${ECR%%/*}
# API image (from a fresh clone of the repo with the Dockerfile copied in):
docker build --target runtime -t $ECR:bootstrap .            # in the repo root
docker build --target migrate -t $ECR:migrate-bootstrap .
docker push $ECR:bootstrap && docker push $ECR:migrate-bootstrap
# Web image (frontend):
docker build -t $ECR:web ~/tradingvue-infra/docker/web && docker push $ECR:web
# Roll the instance so it pulls the new images:
terraform apply -replace=aws_instance.app -auto-approve
```

### b) Change a CONFIG value or API key
Keys live in SSM `/tradingvue/*`. Update the value, then roll the instance:
```bash
aws ssm put-parameter --name /tradingvue/POLYGON_API_KEY --type SecureString --overwrite --value "NEW_KEY"
terraform apply -replace=aws_instance.app -auto-approve
```

### c) Change INFRASTRUCTURE (instance size, networking, etc.)
Edit `main.tf`, then:
```bash
terraform plan      # review
terraform apply
```

> ⚠️ Replacing the instance **wipes the Postgres data** (the DB lives in a docker
> volume on the instance's root disk). Fine while there's no real user data; see
> Section 5 for how to make data persistent.

---

## 4. Debugging / viewing logs (without shell access)

Because SSM/SSH aren't working, use these read-only paths:

```bash
# Cloud-init / user-data log (shows container startup, migrations, key fetch):
aws ec2 get-console-output --instance-id <id> --query Output --output text | tail -80

# Hit the API directly through CloudFront:
CF=d35buufuexxual.cloudfront.net
curl -s "https://$CF/api/healthz"
curl -s "https://$CF/api/market/quote?symbol=AAPL"
```
Get `<id>` with `terraform output -raw instance_id`.

---

## 5. Recommended improvements (in priority order)

These turn the current "replace the whole instance for every change" workflow
into something fast and safe:

1. **Fix the instance management agents.** Drop or fix `dnf update -y` in
   user-data so the SSM Agent registers. Then deploys become a one-liner with no
   instance replacement and no data loss:
   ```bash
   aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript \
     --parameters 'commands=["cd /opt/tradingvue && docker compose pull && docker compose up -d"]'
   ```
   You'd also get `docker logs` remotely for debugging.

2. **Make the database persistent.** Mount a dedicated EBS volume for the
   Postgres data dir (or move to a small RDS instance). Then replacing the EC2
   instance no longer destroys data.

3. **Commit the lite IaC + add CI/CD.** The `infra/lite` + `docker/web` files
   are not yet in the GitHub repo (only the Fargate design is, in PR #1). Commit
   them, then add a GitHub Actions workflow: on push → build & push images →
   `aws ssm send-command` to redeploy. That makes "fix → git push → live" the
   whole loop.

4. **Patch the app bugs upstream** (Section 2) so the workarounds can be removed.

5. **(Optional) Real domains.** Add a Route 53 hosted zone + ACM certificate +
   CloudFront alias to get `app.yourdomain.com` instead of a random
   `*.cloudfront.net` host (and a `staging.` subdomain if you want two envs).

---

## 6. Useful identifiers

- Account: 026818611950 · Region: ap-southeast-1
- ECR repo: `026818611950.dkr.ecr.ap-southeast-1.amazonaws.com/tradingvue/app`
- State bucket: `tradingvue-tfstate-026818611950` · lock table: `tradingvue-tf-locks`
- SSM keys: `/tradingvue/POLYGON_API_KEY`, `/tradingvue/ALPACA_API_KEY`,
  `/tradingvue/ALPACA_API_SECRET`, `/tradingvue/OPENAI_API_KEY`, `/tradingvue/OPENAI_BASE_URL`
