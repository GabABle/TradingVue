# TradingVue — Infrastructure & Deployment Reference

> Purpose: a complete, self-contained description of how the TradingVue app is
> deployed on AWS, written so an LLM or engineer can make **targeted code or
> infrastructure changes without re-discovering the system**. Read sections 1–4
> for the mental model, then use section 8 ("How to change X") as a lookup table.

---

## 0. TL;DR

- The app is **live** at **https://d35buufuexxual.cloudfront.net/**.
- It runs as **3 Docker containers on ONE small EC2 instance** (`t3.micro`),
  fronted by **CloudFront** for HTTPS. Cost ≈ **$10/month**.
- Infrastructure is **Terraform** in `infra/lite/`. The app is built into
  **3 ECR images**. Secrets come from **SSM Parameter Store**.
- Region **ap-southeast-1**, account **026818611950**.
- This is a deliberately minimal, single-environment, low-cost design (no NAT
  gateway, no load balancer, no RDS, no Fargate, no staging/prod split).

---

## 1. The application

TradingVue is a TradingView-style charting app. Source repo:
**https://github.com/GabABle/TradingVue** (a pnpm monorepo).

| Part | Path in repo | What it is | Becomes ECR image |
|------|--------------|------------|-------------------|
| Frontend | `artifacts/trading-chart` | React 19 + Vite SPA (lightweight-charts) | baked into `:web` |
| API | `artifacts/api-server` | Express 5, bundled by esbuild to `dist/index.mjs` | `:bootstrap` |
| DB layer | `lib/db` | Drizzle ORM + schema | used by `:migrate-bootstrap` |
| Shared libs | `lib/*` | api-zod, api-client-react, integrations-openai-ai-server | bundled in |

The API listens on **port 8080**, health endpoint **`/api/healthz`** (returns
`{"status":"ok"}`). The frontend talks to the API via **same-origin relative
`/api/...`** calls (no CORS needed).

### External market-data providers (called by the API)
| Data | Provider | Auth (env var) |
|------|----------|----------------|
| Stock quote (watchlist "LAST") | Alpaca snapshot | `ALPACA_API_KEY` + `ALPACA_API_SECRET` |
| Stock daily/weekly bars (chart) | **Polygon** | `POLYGON_API_KEY` |
| Stock intraday bars | Alpaca IEX | `ALPACA_API_KEY` + `ALPACA_API_SECRET` |
| Crypto quote | Alpaca crypto | none (free feed) |
| Crypto bars | Polygon | `POLYGON_API_KEY` |
| Forex | Frankfurter/ECB | none |
| Futures + News | Yahoo Finance | none |
| AI Analyst panel | OpenAI-compatible | `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` |

Relevant source: `artifacts/api-server/src/routes/market.ts`.

---

## 2. Cloud architecture (the live "lite" stack)

```
            Browser (HTTPS)
                 │
                 ▼
        ┌─────────────────────┐   *.cloudfront.net TLS, redirect-to-https
        │     CloudFront      │   default behaviour: CachingDisabled + AllViewer
        └─────────┬───────────┘   origin = the EC2's Elastic-IP public DNS (HTTP)
                  │ HTTP (only CloudFront IPs allowed by the security group)
                  ▼
        ┌─────────────────────────────────────────────┐
        │   EC2 t3.micro (public subnet, Elastic IP)   │
        │   docker-compose project "tradingvue":       │
        │                                              │
        │   web (nginx)  :80  ── serves SPA            │
        │       │  proxy /api/* ─► api :8080           │
        │   api (Express) :8080 ──► db :5432           │
        │   db (postgres:16-alpine, volume pgdata)     │
        └─────────────────────────────────────────────┘
                  │ outbound (egress all) → ECR pulls, SSM reads, market APIs
```

AWS resources (all in `infra/lite/main.tf`):

| Resource | Name / detail | Notes |
|----------|---------------|-------|
| VPC | `tradingvue-lite`, `10.1.0.0/16` | DNS support + hostnames on |
| Subnet | `10.1.0.0/24`, public, auto-assign public IP | 1 AZ only |
| Internet gateway + route table | `0.0.0.0/0` → IGW | no NAT gateway |
| Security group | `tradingvue-lite` | ingress **80 from the CloudFront managed prefix list** `com.amazonaws.global.cloudfront.origin-facing`; egress all. **No SSH (22) in steady state.** |
| EC2 instance | `aws_instance.app`, `t3.micro`, AL2023 x86_64, 20 GB gp3 encrypted | `user_data_replace_on_change = true` |
| Elastic IP | `aws_eip.app` | attached to the instance; CloudFront origin = `aws_eip.app.public_dns` |
| IAM role + instance profile | `tradingvue-lite-instance` | policies below |
| CloudFront distribution | `aws_cloudfront_distribution.this` | default cert; one origin (the EC2) |
| `random_password` | `db` (24 chars), `jwt` (48 chars) | generated, injected via user-data |

IAM policies on the instance role:
- `AmazonSSMManagedInstanceCore` (managed)
- `AmazonEC2ContainerRegistryReadOnly` (managed) — pull images from ECR
- inline `read-app-secrets` — `ssm:GetParameter[s]` on
  `arn:aws:ssm:ap-southeast-1:026818611950:parameter/tradingvue/*` and
  `kms:Decrypt` (scoped to `kms:ViaService = ssm.ap-southeast-1.amazonaws.com`)

---

## 3. Container images (ECR)

Repository: `026818611950.dkr.ecr.ap-southeast-1.amazonaws.com/tradingvue/app`

| Tag | Built from | Purpose |
|-----|-----------|---------|
| `:bootstrap` | repo `Dockerfile` target `runtime` | the Express API |
| `:migrate-bootstrap` | repo `Dockerfile` target `migrate` | runs `drizzle-kit push` (creates `user_portfolio`) |
| `:web` | `docker/web/Dockerfile` | nginx + the built Vite frontend |

The repo `Dockerfile` (multi-stage) and `docker/web/Dockerfile` both clone the
public repo and build with pnpm. **Build flags that matter** (do not remove):
`pnpm install --no-frozen-lockfile --prod=false` (the repo lockfile's overrides
are stale, and the build tools live in devDependencies).

---

## 4. How the app boots (the instance's `user_data.sh.tftpl`)

On instance launch the user-data script (Terraform-templated; `${...}` are
template vars) does, in order:

1. Install Docker + the docker-compose v2 plugin.
2. ECR login (via the instance role).
3. **Fetch API keys from SSM** (`/tradingvue/ALPACA_API_KEY`, `ALPACA_API_SECRET`,
   `POLYGON_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`) and write them to
   `/opt/tradingvue/app-secrets.env` (chmod 600). Keys are pulled at boot — they
   are **never** stored in the Terraform/user-data text.
4. Write `/opt/tradingvue/docker-compose.yml`.
5. `docker compose up -d db`, wait for healthy.
6. **Create the auth tables** via `psql` (the repo has no migration for them).
7. Run the `:migrate-bootstrap` image (drizzle push → `user_portfolio`).
8. `docker compose up -d` (starts `api` + `web`).

The compose `api` service env:
- inline: `NODE_ENV=production`, `PORT=8080`,
  `DATABASE_URL=postgres://tradingvue:<db_pw>@db:5432/tradingvue?application_name=localhost`,
  `JWT_SECRET=<generated>`
- `env_file: app-secrets.env` (the API keys from step 3)

---

## 5. Configuration & secrets

| Value | Source | Consumed by |
|-------|--------|-------------|
| `POLYGON_API_KEY` | SSM `/tradingvue/POLYGON_API_KEY` (SecureString) | api env_file |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | SSM `/tradingvue/ALPACA_API_KEY`, `/ALPACA_API_SECRET` | api env_file |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | SSM `/tradingvue/OPENAI_API_KEY` | api env_file |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | SSM `/tradingvue/OPENAI_BASE_URL` | api env_file |
| `DATABASE_URL` | composed from generated `db` password | api inline env |
| `JWT_SECRET` | generated `random_password.jwt` | api inline env |
| ECR repo URL | SSM `/tradingvue/shared/ecr_repository_url` | Terraform data source |

> SSM also contains `/tradingvue/DATABASE_URL` and `/tradingvue/JWT_SECRET`, but
> the lite stack **generates its own** DB password + JWT and does not use those.

---

## 6. State & backend

- Terraform remote state: **S3 `tradingvue-tfstate-026818611950`**, object key
  `lite/terraform.tfstate`, region ap-southeast-1.
- State lock: **DynamoDB `tradingvue-tf-locks`**.
- The `infra/bootstrap/` stack (run once, local state) created the state bucket,
  lock table, the ECR repo, a GitHub OIDC role, and `/tradingvue/shared/ecr_repository_url`.

---

## 7. App-level quirks baked into this deployment

These are **upstream app bugs** that the deployment works around. If you fix
them in the repo, you can simplify the deployment:

1. **Missing auth-table migrations.** Repo migrates only `user_portfolio`;
   `users`, `user_watchlists`, `user_preferences`, `user_alerts` are created by a
   `psql` step in `user_data.sh.tftpl`.
2. **DB pool forces SSL.** `api-server/src/lib/db.ts` enables SSL unless
   `DATABASE_URL` contains "localhost"/"127.0.0.1"; the local Postgres has no
   SSL → the URL carries `?application_name=localhost` to force the non-SSL path.
3. **OpenAI integration throws at import** without `AI_INTEGRATIONS_OPENAI_*`
   (set from SSM, with placeholder fallback).
4. **Health path is `/api/healthz`** (not `/api/health`).

---

## 8. How to change X  (lookup table)

> Tooling: all ops run from **AWS CloudShell** (ap-southeast-1). Terraform isn't
> persisted across CloudShell sessions — reinstall via the HashiCorp dnf repo if
> missing. Because CloudShell's home is 1 GB, point Terraform plugins at /tmp:
> `export TF_DATA_DIR=/tmp/tfdata-lite TF_PLUGIN_CACHE_DIR=/tmp/tfplugins`.
> Init: `terraform init -backend-config="bucket=tradingvue-tfstate-026818611950"`
> (run from `infra/lite/`).

| Goal | Edit | Apply |
|------|------|-------|
| **Frontend code** | repo (`artifacts/trading-chart`) | rebuild `:web`, push, then `terraform apply -replace=aws_instance.app` |
| **API code** | repo (`artifacts/api-server`) | rebuild `:bootstrap` (+ `:migrate-bootstrap` if schema), push, then `terraform apply -replace=aws_instance.app` |
| **DB schema / new table** | the `psql` block in `infra/lite/user_data.sh.tftpl` (and/or repo migrations) | `terraform apply` (user-data change → instance replaced) |
| **Add/rotate an API key** | `aws ssm put-parameter --name /tradingvue/<NAME> --type SecureString --overwrite --value <V>` | `terraform apply -replace=aws_instance.app` |
| **Add a NEW env var to the API** | add to the env file write + compose `env_file`/`environment` in `user_data.sh.tftpl`; grant SSM read if from a new param | `terraform apply` |
| **Instance size / disk** | `var.instance_type` / `root_block_device` in `infra/lite/main.tf` | `terraform apply` |
| **Networking / SG rules** | `infra/lite/main.tf` | `terraform apply` |
| **Tear it all down** | — | `terraform destroy` (in `infra/lite/`) |

> ⚠️ Replacing the instance **wipes the Postgres data** (DB is a docker volume on
> the root disk). Acceptable while there's no production data; see section 10 #2.

Rebuild-and-push commands (from a fresh clone of the repo with the Dockerfiles
copied in):
```bash
ECR=026818611950.dkr.ecr.ap-southeast-1.amazonaws.com/tradingvue/app
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ${ECR%%/*}
docker build --target runtime -t $ECR:bootstrap .
docker build --target migrate -t $ECR:migrate-bootstrap .
docker push $ECR:bootstrap && docker push $ECR:migrate-bootstrap
docker build -t $ECR:web ./docker/web && docker push $ECR:web
```

---

## 9. Verify / debug

```bash
CF=d35buufuexxual.cloudfront.net
curl -s "https://$CF/api/healthz"                              # app up?
curl -s "https://$CF/api/market/quote?symbol=AAPL"            # Alpaca working?
curl -s "https://$CF/api/market/bars?symbol=AAPL&timeframe=1Day&limit=2"  # Polygon working?
# Instance boot log (container startup, migrations, key fetch):
aws ec2 get-console-output --instance-id $(terraform output -raw instance_id) --query Output --output text | tail -80
```

> The SSM Agent and EC2 Instance Connect are currently **not working** on the
> instance (the `dnf update -y` in user-data disrupts them), so there is no live
> shell today — use console output + the CloudFront-fronted API for debugging,
> or replace the instance to apply fixes. Fixing this is the #1 improvement below.

---

## 10. Recommended improvements (to make changes easier)

1. **Fix the SSM Agent** (remove/adjust `dnf update -y`). Then deploys become
   `aws ssm send-command ... "cd /opt/tradingvue && docker compose pull && docker compose up -d"`
   — no instance replacement, no data loss, plus remote `docker logs`.
2. **Persist the DB** on a dedicated EBS volume (or RDS) so instance replacement
   doesn't destroy data.
3. **Commit `infra/lite/` + `docker/web/` to the repo and add CI/CD.** They are
   currently only in an uploaded CloudShell bundle, not in GitHub (GitHub's
   PR #1 holds the older Fargate design). With them committed, GitHub Actions can
   build images on push and trigger a redeploy via SSM.
4. **Patch the app bugs (section 7) upstream** and drop the workarounds.
5. **Custom domain**: Route 53 + ACM + CloudFront alias for `app.<domain>`.

---

## 11. Reference identifiers

| Item | Value |
|------|-------|
| Account / Region | 026818611950 / ap-southeast-1 |
| Live URL | https://d35buufuexxual.cloudfront.net/ |
| ECR repo | 026818611950.dkr.ecr.ap-southeast-1.amazonaws.com/tradingvue/app |
| TF state bucket / lock | tradingvue-tfstate-026818611950 / tradingvue-tf-locks |
| SSM keys | /tradingvue/POLYGON_API_KEY, /ALPACA_API_KEY, /ALPACA_API_SECRET, /OPENAI_API_KEY, /OPENAI_BASE_URL |
| Source repo | https://github.com/GabABle/TradingVue |
| IaC (this app) | infra/lite/{main.tf,backend.tf,user_data.sh.tftpl} + docker/web/{Dockerfile,nginx.conf} |
| Alternative (unused) IaC | infra/bootstrap, infra/modules, infra/environments = the higher-cost Fargate+RDS design |
