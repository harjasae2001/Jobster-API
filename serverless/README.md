# Jobster API — Serverless AWS Stack

> A focused serverless migration of the Jobster job-tracking API from Express/MongoDB to **Lambda + DynamoDB + API Gateway + S3 + CloudFront** on AWS (`ap-south-1` · Mumbai).

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │                   AWS Cloud                  │
                         │                 (ap-south-1)                 │
  Browser / React  ──►  │  CloudFront ──► S3 (React SPA)               │
                         │      │                                        │
                         │      └──► API Gateway (REST)                 │
                         │               │                              │
                         │       ┌───────┴───────────────┐             │
                         │       │                       │             │
                         │  Auth Lambdas            Jobs Lambdas       │
                         │  (RegisterFn, LoginFn)   (GetAll, Create,   │
                         │       │                   GetOne)           │
                         │       └───────┬───────────────┘             │
                         │               ▼                              │
                         │          DynamoDB                            │
                         │      (JobsterTable, single-table)            │
                         │               │                              │
                         │          CloudWatch Logs                     │
                         └──────────────────────────────────────────────┘
```

---

## Endpoints

| Method | Path | Lambda | Auth |
|--------|------|--------|------|
| `POST` | `/api/v1/auth/register` | `auth-register.js` | ✗ |
| `POST` | `/api/v1/auth/login` | `auth-login.js` | ✗ |
| `GET` | `/api/v1/jobs` | `jobs-get-all.js` | ✓ Bearer JWT |
| `POST` | `/api/v1/jobs` | `jobs-create.js` | ✓ Bearer JWT |
| `GET` | `/api/v1/jobs/{id}` | `jobs-get-one.js` | ✓ Bearer JWT |

Query params for `GET /api/v1/jobs`: `search`, `status`, `jobType`, `sort` (`latest`/`oldest`/`a-z`/`z-a`), `page`, `limit`

---

## DynamoDB Single-Table Design

### Access Patterns & Key Structure

| Access Pattern | PK | SK | GSI1PK | GSI1SK |
|---------------|----|----|--------|--------|
| Register user | `USER#<email>` | `PROFILE` | `USER#<email>` | `PROFILE` |
| Login (by email) | `USER#<email>` | `PROFILE` | — | — |
| Auth middleware lookup | `USERID#<userId>` | `PROFILE` | — | — |
| Get all jobs for user | `USER#<userId>` | begins_with `JOB#` | — | — |
| Get single job | `USER#<userId>` | `JOB#<jobId>` | — | — |
| Create job | `USER#<userId>` | `JOB#<jobId>` | — | — |

### Attributes

**User item** (`PK=USER#<email>`, `SK=PROFILE`):
```json
{
  "PK":       "USER#john@example.com",
  "SK":       "PROFILE",
  "userId":   "a1b2c3d4-...",
  "name":     "John",
  "lastName": "Doe",
  "email":    "john@example.com",
  "password": "$2a$10$...",
  "location": "Mumbai",
  "entityType": "USER",
  "createdAt": "2026-07-15T08:00:00.000Z",
  "updatedAt": "2026-07-15T08:00:00.000Z"
}
```

**Job item** (`PK=USER#<userId>`, `SK=JOB#<jobId>`):
```json
{
  "PK":           "USER#a1b2c3d4-...",
  "SK":           "JOB#f1e2d3c4-...",
  "jobId":        "f1e2d3c4-...",
  "company":      "Acme Corp",
  "position":     "Software Engineer",
  "positionLower": "software engineer",
  "status":       "pending",
  "jobType":      "full-time",
  "jobLocation":  "Mumbai",
  "createdBy":    "a1b2c3d4-...",
  "entityType":   "JOB",
  "createdAt":    "2026-07-15T09:00:00.000Z",
  "updatedAt":    "2026-07-15T09:00:00.000Z"
}
```

### Design Decisions Worth Discussing

1. **Why single-table?** — A Query on `PK=USER#<userId>` with `SK begins_with JOB#` retrieves all a user's jobs in **one round trip**. With separate tables you'd need two round trips (fetch user, fetch jobs) or a JOIN that DynamoDB doesn't support.

2. **Why two user items?** — Login needs to look up by email. Job queries use userId. Storing two items (one keyed by email, one by userId) lets both lookups be O(1) GetItem calls instead of requiring an index.

3. **Email uniqueness enforcement** — DynamoDB has no unique constraint on non-key attributes. We enforce it via `ConditionExpression: attribute_not_exists(PK)` on `PutItem`. If the email already exists, DynamoDB throws `ConditionalCheckFailedException` → we return 409 Conflict.

4. **Case-insensitive search** — DynamoDB's `contains()` is case-sensitive. We store a `positionLower` field at write time and compare against `search.toLowerCase()` in FilterExpression.

5. **In-memory sort** — DynamoDB sorts by SK only. Since SK is `JOB#<uuid>`, there's no meaningful order. We sort in memory after querying — acceptable for per-user job sets (typically < 500). A GSI with `GSI2SK = <ISO date>` would be the right solution at scale.

---

## IAM Least-Privilege

Two scoped roles — **no shared wildcard policies**:

```
AuthFunctionRole (RegisterFn, LoginFn)
  └── dynamodb:PutItem    → JobsterTable + GSI1
  └── dynamodb:GetItem    → JobsterTable + GSI1
  └── (no Query, no DeleteItem, no UpdateItem, no Scan)

JobsFunctionRole (GetAllFn, CreateFn, GetOneFn)
  └── dynamodb:PutItem    → JobsterTable only
  └── dynamodb:GetItem    → JobsterTable only
  └── dynamodb:Query      → JobsterTable only
  └── (no GSI access — jobs never touch the email index)
```

Both roles also have `AWSLambdaBasicExecutionRole` (CloudWatch Logs write only).

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| AWS CLI | v2 | https://aws.amazon.com/cli/ |
| SAM CLI | latest | `pip install aws-sam-cli` |
| Docker | any | https://docker.com (for `sam local`) |

Configure AWS credentials:
```bash
aws configure
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region: ap-south-1
# Default output format: json
```

---

## Quick Start

### 1. Install dependencies
```bash
cd serverless
npm install
```

### 2. Build
```bash
sam build
# Installs node_modules, packages each function + shared layer
```

### 3. First-time deploy (guided)
```bash
sam deploy --guided
```
You will be prompted for:
- **Stack name**: `jobster-serverless`
- **Region**: `ap-south-1`
- **JwtSecret**: your JWT secret key (min 16 chars)
- **JwtLifetime**: `1d`
- **FrontendBucketSuffix**: `a7f3k9` (or any random string)

SAM creates all resources. Final output:
```
Key   ApiEndpoint     Value  https://abc123.execute-api.ap-south-1.amazonaws.com/production
Key   FrontendURL     Value  https://d1234abcd.cloudfront.net
Key   FrontendBucket  Value  jobster-frontend-a7f3k9
```

### 4. Seed DynamoDB with test data
```bash
TABLE_NAME=JobsterTable-production node scripts/seed.js
```

### 5. Deploy frontend
```powershell
.\scripts\deploy-frontend.ps1
```

### 6. Subsequent deploys
```bash
sam build && sam deploy
```

---

## Local Development (without AWS account)

### Start DynamoDB Local
```bash
docker run -d -p 8000:8000 --name ddb-local amazon/dynamodb-local
```

### Create the table locally
```bash
aws dynamodb create-table \
  --table-name JobsterTable-development \
  --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes '[{"IndexName":"GSI1","KeySchema":[{"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000 \
  --region ap-south-1
```

### Set environment and seed
```bash
export DYNAMODB_ENDPOINT=http://localhost:8000
export TABLE_NAME=JobsterTable-development
export JWT_SECRET=local-dev-secret-key-12345678
export JWT_LIFETIME=1d
node scripts/seed.js
```

### Start SAM local API
```bash
sam local start-api --env-vars .env.json
```

---

## AWS Cost Analysis — $120 Credit Budget

> Pricing for **ap-south-1 (Mumbai)**, as of July 2026. All figures are **monthly estimates** for a portfolio/demo workload with moderate usage.

### Cost Breakdown Table

| Service | Component | Usage Assumption | Unit Price | Monthly Cost |
|---------|-----------|-----------------|-----------|-------------|
| **Lambda** | Invocations | 50,000/month | $0.20 per 1M | **$0.01** |
| **Lambda** | Duration (arm64) | 50k × 128MB × avg 500ms | $0.0000133971 per GB-sec | **$0.04** |
| **API Gateway** | REST API calls | 50,000/month | $3.50 per 1M | **$0.18** |
| **DynamoDB** | Read Request Units | 100,000 RRU/month | $0.285 per 1M | **$0.03** |
| **DynamoDB** | Write Request Units | 25,000 WRU/month | $1.425 per 1M | **$0.04** |
| **DynamoDB** | Storage | < 1 GB | $0.285/GB | **< $0.01** |
| **S3** | Storage | < 100 MB build | $0.025/GB | **< $0.01** |
| **S3** | GET requests | 10,000/month | $0.004 per 1K | **$0.04** |
| **CloudFront** | Data transfer | 1 GB/month | $0.114/GB | **$0.11** |
| **CloudFront** | HTTP requests | 50,000/month | $0.0120 per 10K | **$0.06** |
| **CloudWatch Logs** | Ingestion | ~100 MB/month | $0.61/GB | **$0.06** |
| **IAM** | Roles & Policies | — | Free | **$0.00** |
| **CloudFormation** | Stack | — | Free | **$0.00** |
| | | | **Total** | **~$0.58/month** |

### Total Cost Summary

```
Monthly cost at portfolio traffic:    ~$0.58/month
Annual cost:                          ~$6.96/year
Time before $120 credits expire:      ~17 years (!)
```

### Free Tier Impact (first 12 months)

The AWS Free Tier further reduces cost to **~$0.00/month** for the first year:

| Service | Free Tier Allowance |
|---------|---------------------|
| Lambda | 1M invocations/month + 400,000 GB-seconds |
| API Gateway | 1M API calls/month |
| DynamoDB | 25 GB storage + 25 RCU + 25 WCU (provisioned) |
| S3 | 5 GB storage + 20,000 GET + 2,000 PUT |
| CloudFront | 1 TB data transfer + 10M requests |
| CloudWatch | 5 GB log ingestion |

All of the above are well within free tier limits for a portfolio project.

### What Would Burn Through $120 Credits?

To actually exhaust your credits at scale:

| Scenario | Lambda invocations | Cost to hit $120 |
|----------|--------------------|-----------------|
| Portfolio demo | ~50K/month | **Never** (~17 years) |
| Light startup (~10K DAU) | ~5M/month | ~$12/month → 10 months |
| Medium traffic (~100K DAU) | ~50M/month | ~$80/month → 1.5 months |
| High traffic (~1M DAU) | ~500M/month | ~$500/month → **Credits gone in 7 days** |

### Cost Optimizations Already Applied

1. **arm64 (Graviton2) architecture** — ~20% cheaper than x86_64 per GB-second
2. **128 MB memory** — minimum needed; Lambda bills on GB-seconds
3. **Shared dependencies Layer** — smaller function ZIP = faster cold starts = less billed duration
4. **PAY_PER_REQUEST DynamoDB** — no minimum fee, scales to zero
5. **`AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`** — reuses HTTP keep-alive connections to DynamoDB across warm invocations, cutting ~50ms off typical latency

### When to Worry About Cost

Set a **CloudWatch Billing Alarm** to alert you at $10:
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "JobsterBillingAlert" \
  --alarm-description "Alert when monthly AWS bill exceeds $10" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --dimensions Name=Currency,Value=USD \
  --period 86400 \
  --evaluation-periods 1 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:<account-id>:billing-alerts
```

---

## Interview Talking Points

### Lambda Cold Starts
> **Q: How do you handle cold starts?**
>
> - All dependencies are in a shared **Lambda Layer** — function ZIP is < 10 KB (just handler code), so cold start unpacks fast
> - **128 MB + arm64** is actually better for cold starts than 1 GB + x86 for I/O-bound code because less memory to initialise
> - DynamoDB client is initialised **at module scope** (not inside the handler), so it's reused on warm invocations
> - For production: Lambda **Provisioned Concurrency** keeps N instances warm (costs ~$10/month for 2 instances)

### DynamoDB vs MongoDB
> **Q: Why DynamoDB over MongoDB Atlas?**
>
> - **No connection pool management** — DynamoDB is HTTP/REST, not TCP sockets. Lambda's stateless execution model means a new connection per cold start in MongoDB; DynamoDB sidesteps this entirely
> - **Single-table design** forces you to think about access patterns up front, resulting in extremely predictable performance (every op is O(1) or O(n) by user)
> - **Operational overhead** — DynamoDB is fully managed (no patching, backups are one checkbox)
> - **Cost at scale** — DynamoDB can be cheaper than MongoDB Atlas at millions of ops/day; comparable at portfolio scale

### IAM Least Privilege
> **Q: Walk me through your IAM setup.**
>
> - Two IAM roles: `AuthFunctionRole` (PutItem + GetItem only) and `JobsFunctionRole` (PutItem + GetItem + Query only)
> - No `dynamodb:*` wildcards — if an auth function gets exploited, it cannot delete jobs
> - No cross-table access — scoped to one table ARN
> - `AWSLambdaBasicExecutionRole` is a managed policy granting only CloudWatch Logs write — that's the minimum needed for Lambda to log

### API Gateway Request Validation
> **Q: How do you validate inputs before Lambda runs?**
>
> - API Gateway **Request Models** define JSON Schema for register/login bodies
> - Gateway rejects malformed requests with 400 before invoking Lambda — saves cost and reduces attack surface
> - Field-level validation (length, enum values) happens inside the Lambda handler

### S3 + CloudFront Security
> **Q: How is the frontend bucket secured?**
>
> - Bucket has **all public access blocked** — no one can hit S3 directly
> - CloudFront uses **Origin Access Control (OAC)** — the S3 bucket policy only allows `s3:GetObject` from the specific CloudFront distribution ARN
> - Forces HTTPS everywhere (ViewerProtocolPolicy: redirect-to-https)

---

## File Structure

```
serverless/
├── template.yaml              # SAM IaC — all AWS resources
├── samconfig.toml             # SAM CLI defaults (region, stack name)
├── package.json               # Lambda dependencies
├── .env.example               # Environment variables documentation
├── README.md                  # This file
├── src/
│   ├── handlers/
│   │   ├── auth-register.js   # POST /api/v1/auth/register
│   │   ├── auth-login.js      # POST /api/v1/auth/login
│   │   ├── jobs-get-all.js    # GET  /api/v1/jobs
│   │   ├── jobs-create.js     # POST /api/v1/jobs
│   │   └── jobs-get-one.js    # GET  /api/v1/jobs/{id}
│   └── lib/
│       ├── dynamo-client.js   # Shared DDB DocumentClient (module-scope init)
│       ├── auth-middleware.js # JWT verification (port of middleware/authentication.js)
│       ├── response.js        # API Gateway response builder
│       └── errors.js          # Custom error classes (port of errors/)
├── scripts/
│   ├── seed.js                # Seed DynamoDB with mock-data.json
│   └── deploy-frontend.ps1   # Sync React build to S3 + invalidate CloudFront
└── events/                    # Test payloads for sam local invoke
    ├── auth-register.json
    ├── auth-login.json
    ├── jobs-create.json
    ├── jobs-get-all.json
    └── jobs-get-one.json
```
