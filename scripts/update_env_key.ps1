param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$Key,
  [Parameter(Mandatory = $true)][string]$Value
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) {
  throw "Env file not found: $EnvFile"
}

$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
$backupFile = "$EnvFile.bak.$timestamp"
Copy-Item -LiteralPath $EnvFile -Destination $backupFile

$lines = Get-Content -LiteralPath $EnvFile
$updated = $false
$newLines = foreach ($line in $lines) {
  if ($line -match "^\s*$([regex]::Escape($Key))=") {
    $updated = $true
    "$Key=$Value"
  } else {
    $line
  }
}

if (-not $updated) {
  $newLines += "$Key=$Value"
}

Set-Content -LiteralPath $EnvFile -Value $newLines
Write-Host "Updated $Key in $EnvFile"
Write-Host "Backup: $backupFile"
