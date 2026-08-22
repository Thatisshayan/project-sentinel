$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$Failures = 0
$Warnings = 0

function Pass($Message) { Write-Host "PASS: $Message" }
function Warn($Message) { Write-Host "WARN: $Message"; $script:Warnings++ }
function Fail($Message) { Write-Host "FAIL: $Message"; $script:Failures++ }

function Get-EnvValue([string]$FilePath, [string]$Key) {
  if (-not (Test-Path $FilePath)) { return $null }
  $lines = Get-Content $FilePath
  $value = $null
  foreach ($line in $lines) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") {
      $value = $Matches[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
  }
  return $value
}

function Check-File([string]$FilePath) {
  if (Test-Path $FilePath) { Pass "$FilePath exists" } else { Fail "$FilePath is missing" }
}

function Check-Key([string]$FilePath, [string]$Key, [string]$Label) {
  $value = Get-EnvValue $FilePath $Key
  if (-not [string]::IsNullOrWhiteSpace($value)) { Pass $Label } else { Fail $Label }
}

function Check-Command([string]$CommandName) {
  if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
    Pass "$CommandName is installed"
  } else {
    Fail "$CommandName is not installed"
  }
}

Check-File '.env'
Check-File 'backend/.env'
Check-File 'ui/.env'

Check-Command 'git'
Check-Command 'docker'

$hasDockerCompose = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  docker compose version *> $null
  if ($LASTEXITCODE -eq 0) {
    $hasDockerCompose = $true
    Pass 'docker compose is available'
  }
}
if (-not $hasDockerCompose) {
  if (Get-Command 'docker-compose' -ErrorAction SilentlyContinue) {
    Pass 'docker-compose is available'
  } else {
    Fail 'docker compose plugin is not available'
  }
}

Check-Key '.env' 'POSTGRES_PASSWORD' 'root .env has POSTGRES_PASSWORD'
Check-Key '.env' 'PUBLIC_DOMAIN' 'root .env has PUBLIC_DOMAIN'

$backendKeys = @(
  'GITHUB_WEBHOOK_SECRET',
  'NOTION_API_KEY',
  'NOTION_DATABASE_ID',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DEBUGGER_SHARED_SECRET',
  'GITHUB_ORG',
  'SENTINEL_UI_KEY',
  'GITHUB_TOKEN'
)
foreach ($key in $backendKeys) {
  Check-Key 'backend/.env' $key "backend/.env has $key"
}

Check-Key 'ui/.env' 'SENTINEL_API_URL' 'ui/.env has SENTINEL_API_URL'
Check-Key 'ui/.env' 'SENTINEL_UI_KEY' 'ui/.env has SENTINEL_UI_KEY'

$backendUiKey = Get-EnvValue 'backend/.env' 'SENTINEL_UI_KEY'
$frontendUiKey = Get-EnvValue 'ui/.env' 'SENTINEL_UI_KEY'
if (-not [string]::IsNullOrWhiteSpace($backendUiKey) -and -not [string]::IsNullOrWhiteSpace($frontendUiKey)) {
  if ($backendUiKey -eq $frontendUiKey) {
    Pass 'backend/ui SENTINEL_UI_KEY values match'
  } else {
    Fail 'backend/ui SENTINEL_UI_KEY values do not match'
  }
}

$providerKeys = @(
  'NVIDIA_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'OPENROUTER_API_KEY',
  'DASHSCOPE_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY'
)
$hasProviderKey = $false
foreach ($key in $providerKeys) {
  if (-not [string]::IsNullOrWhiteSpace((Get-EnvValue 'backend/.env' $key))) {
    $hasProviderKey = $true
    break
  }
}
if ($hasProviderKey) {
  Pass 'backend/.env has at least one AI provider key'
} else {
  Fail 'backend/.env has no AI provider key; audits/chat/build fixes will not run'
}

# For the self-hosted Oracle deployment, aider runs inside the backend image,
# not on the VM host. A missing host-side binary is therefore not a production
# blocker. If the backend container is already running, verify aider there;
# otherwise just note that the image is expected to supply it at runtime.
$backendPsOutput = docker compose -f docker-compose.prod.yml ps backend 2>$null
if ($LASTEXITCODE -eq 0 -and $backendPsOutput) {
  docker compose -f docker-compose.prod.yml exec -T backend sh -lc 'aider --version' *> $null
  if ($LASTEXITCODE -eq 0) {
    Pass 'backend container aider command runs'
  } else {
    Warn 'backend container aider check failed; verify after the backend is up'
  }
} elseif (Get-Command aider -ErrorAction SilentlyContinue) {
  cmd /c "aider --version >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Pass 'host aider command runs'
  } else {
    Warn 'host aider is installed but aider --version failed; backend image should still provide aider'
  }
} else {
  Warn 'host aider is not installed; acceptable for Docker deploy because the backend image bundles aider'
}

$dockerConfig = Join-Path $HOME '.docker/config.json'
try {
  if ((Test-Path $dockerConfig) -and ((Get-Content $dockerConfig -Raw) -match 'ghcr\.io')) {
    Pass 'docker client has a ghcr.io login entry'
  } else {
    Warn 'docker client has no visible ghcr.io login entry; image pulls may fail'
  }
} catch {
  Warn 'could not inspect ~/.docker/config.json; verify ghcr.io login manually'
}

docker compose -f docker-compose.prod.yml config *> $null
if ($LASTEXITCODE -eq 0) {
  Pass 'docker-compose.prod.yml resolves successfully'
} else {
  Fail 'docker-compose.prod.yml does not resolve cleanly with the current env files'
}

Write-Host ''
Write-Host "Summary: $Failures failure(s), $Warnings warning(s)"
if ($Failures -ne 0) { exit 1 }
