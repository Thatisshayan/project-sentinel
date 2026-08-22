$ErrorActionPreference = 'Continue'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$Failures = 0
$Warnings = 0

function Pass($Message) { Write-Host "PASS: $Message" }
function Warn($Message) { Write-Host "WARN: $Message"; $script:Warnings++ }
function Fail($Message) { Write-Host "FAIL: $Message"; $script:Failures++ }

function Get-EnvValue([string]$FilePath, [string]$Key) {
  if (-not (Test-Path $FilePath)) { return $null }
  $value = $null
  foreach ($line in Get-Content $FilePath) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") {
      $value = $Matches[1].Trim()
    }
  }
  return $value
}

function Get-HttpStatus([string]$Url, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers $Headers -Method Get -TimeoutSec 15 -UseBasicParsing
    return [string]$response.StatusCode
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode) { return [string]$statusCode }
    return '000'
  }
}

docker compose -f docker-compose.prod.yml ps *> $null
if ($LASTEXITCODE -eq 0) {
  Pass 'docker compose responds'
} else {
  Fail 'docker compose is not available for the production stack'
}

$backendPsOutput = docker compose -f docker-compose.prod.yml ps --format json backend 2>$null
if ($backendPsOutput -match '"Health":"healthy"') {
  Pass 'backend container is healthy'
} elseif ($backendPsOutput -match '"State":"running"') {
  Warn 'backend container is running but not yet healthy'
} else {
  Fail 'backend container is not running'
}

docker compose -f docker-compose.prod.yml exec -T backend sh -lc 'aider --version' *> $null
if ($LASTEXITCODE -eq 0) {
  Pass 'backend container aider command runs'
} else {
  Fail 'backend container aider command failed'
}

$internalHealth = docker compose -f docker-compose.prod.yml exec -T backend sh -lc "node -e \"require('http').get('http://localhost:3000/health', r => { console.log(r.statusCode); process.exit(0); }).on('error', () => process.exit(1))\"" 2>$null
if (($internalHealth | Out-String).Trim() -eq '200') {
  Pass 'backend container /health returns 200'
} else {
  Fail "backend container /health returned $($internalHealth | Out-String).Trim()"
}

$internalReady = docker compose -f docker-compose.prod.yml exec -T backend sh -lc "node -e \"require('http').get('http://localhost:3000/ready', r => { console.log(r.statusCode); process.exit(0); }).on('error', () => process.exit(1))\"" 2>$null
if (($internalReady | Out-String).Trim() -eq '200') {
  Pass 'backend container /ready returns 200'
} else {
  Fail "backend container /ready returned $($internalReady | Out-String).Trim()"
}

$publicDomain = Get-EnvValue '.env' 'PUBLIC_DOMAIN'
if (-not [string]::IsNullOrWhiteSpace($publicDomain)) {
  $publicHealth = Get-HttpStatus "https://$publicDomain/health"
  if ($publicHealth -eq '200') {
    Pass 'public /health returns 200'
  } else {
    Fail "public /health returned $publicHealth"
  }

  $publicReady = Get-HttpStatus "https://$publicDomain/ready"
  if ($publicReady -eq '200') {
    Pass 'public /ready returns 200'
  } else {
    Fail "public /ready returned $publicReady"
  }
} else {
  Warn 'PUBLIC_DOMAIN is not set in .env; skipping public endpoint checks'
}

$githubToken = Get-EnvValue 'backend/.env' 'GITHUB_TOKEN'
if (-not [string]::IsNullOrWhiteSpace($githubToken)) {
  $githubStatus = Get-HttpStatus 'https://api.github.com/user' @{ Authorization = "Bearer $githubToken"; Accept = 'application/vnd.github+json' }
  if ($githubStatus -eq '200') {
    Pass 'GitHub token auth returns 200'
  } else {
    Fail "GitHub token auth returned $githubStatus"
  }
} else {
  Fail 'backend/.env is missing GITHUB_TOKEN'
}

$vercelToken = Get-EnvValue 'backend/.env' 'VERCEL_TOKEN'
if (-not [string]::IsNullOrWhiteSpace($vercelToken)) {
  $vercelStatus = Get-HttpStatus 'https://api.vercel.com/v6/deployments?limit=1' @{ Authorization = "Bearer $vercelToken" }
  if ($vercelStatus -eq '200') {
    Pass 'Vercel token can list deployments'
  } elseif ($vercelStatus -in @('401', '403')) {
    Warn "Vercel token exists but deployment API returned $vercelStatus"
  } else {
    Warn "Vercel deployment probe returned $vercelStatus"
  }
} else {
  Warn 'VERCEL_TOKEN is not configured; Vercel build polling will stay disabled'
}

$slackBotId = Get-EnvValue 'backend/.env' 'SLACK_BOT_ID'
if (-not [string]::IsNullOrWhiteSpace($slackBotId)) {
  Pass 'SLACK_BOT_ID is configured'
} else {
  Warn 'SLACK_BOT_ID is not configured; Slack echo protection is degraded'
}

Write-Host ''
Write-Host "Summary: $Failures failure(s), $Warnings warning(s)"
if ($Failures -ne 0) { exit 1 }
