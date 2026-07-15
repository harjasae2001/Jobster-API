# ─────────────────────────────────────────────────────────────────────────────
# deploy-frontend.ps1 — Sync React build to S3 + invalidate CloudFront cache
#
# Usage:
#   .\scripts\deploy-frontend.ps1
#   .\scripts\deploy-frontend.ps1 -StackName jobster-serverless -Profile default
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - SAM stack already deployed (template.yaml creates the S3 bucket)
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$StackName = "jobster-serverless",
    [string]$Region    = "ap-south-1",
    [string]$Profile   = "default"
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Jobster Frontend Deploy" -ForegroundColor Cyan
Write-Host "   Stack  : $StackName"
Write-Host "   Region : $Region"
Write-Host ""

# ── 1. Get S3 bucket name and CloudFront distribution ID from SAM stack outputs
Write-Host "📦 Fetching stack outputs..." -ForegroundColor Yellow

$outputs = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --profile $Profile `
    --query "Stacks[0].Outputs" `
    --output json | ConvertFrom-Json

$bucketName      = ($outputs | Where-Object { $_.OutputKey -eq "FrontendBucketName" }).OutputValue
$distributionId  = ($outputs | Where-Object { $_.OutputKey -eq "CloudFrontDistributionId" }).OutputValue
$cloudfrontUrl   = ($outputs | Where-Object { $_.OutputKey -eq "FrontendURL" }).OutputValue

if (-not $bucketName) {
    Write-Error "Could not find FrontendBucketName in stack outputs. Has the stack been deployed?"
    exit 1
}

Write-Host "   Bucket : $bucketName"
Write-Host "   CDN ID : $distributionId"
Write-Host "   URL    : $cloudfrontUrl"
Write-Host ""

# ── 2. Sync React build to S3
$buildPath = Join-Path $PSScriptRoot "..\..\client\build"
if (-not (Test-Path $buildPath)) {
    Write-Error "React build not found at $buildPath. Run 'npm run build' in the client/ directory first."
    exit 1
}

Write-Host "📤 Syncing $buildPath to s3://$bucketName ..." -ForegroundColor Yellow

# Sync static assets with long cache headers (content-hashed filenames)
aws s3 sync $buildPath "s3://$bucketName" `
    --region $Region `
    --profile $Profile `
    --delete `
    --cache-control "public,max-age=31536000,immutable" `
    --exclude "index.html" `
    --exclude "*.map"

# Sync index.html with no-cache (must always be fresh so SPA routing works)
aws s3 cp "$buildPath\index.html" "s3://$bucketName/index.html" `
    --region $Region `
    --profile $Profile `
    --cache-control "no-cache,no-store,must-revalidate" `
    --content-type "text/html"

Write-Host "   ✓ Sync complete" -ForegroundColor Green

# ── 3. Invalidate CloudFront cache (so users get the new index.html immediately)
if ($distributionId) {
    Write-Host ""
    Write-Host "🔄 Invalidating CloudFront cache..." -ForegroundColor Yellow

    $invalidation = aws cloudfront create-invalidation `
        --distribution-id $distributionId `
        --paths "/*" `
        --profile $Profile `
        --output json | ConvertFrom-Json

    $invalidationId = $invalidation.Invalidation.Id
    Write-Host "   ✓ Invalidation created: $invalidationId (takes ~30-60 seconds)" -ForegroundColor Green
}

Write-Host ""
Write-Host "✅ Frontend deployed successfully!" -ForegroundColor Green
Write-Host "   🌐 $cloudfrontUrl" -ForegroundColor Cyan
