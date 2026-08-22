# Repo-adaptive governance verification (PowerShell / Windows).
# Mirrors scripts/verify.sh: secret-scan, doc-freshness, build, test, deploy-dry.
# Scoped to $RepoRoot only (does NOT walk outside the repo).
$ErrorActionPreference = 'Continue'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot

$failed = $false
function Notice($t,$m){ Write-Host "::notice title=$t::$m" }
function Err($t,$m){ Write-Host "::error title=$t::$m"; $script:failed = $true }

# Pinned gitleaks Docker image for CI fallback (immutable digest for
# supply-chain safety — never use :latest). Update deliberately via
# dependency review, not automated tag tracking.
$GitleaksImage = "zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

# ---------------------------------------------------------------- 0. main guard (Rule 26)
$currentBranch = (git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
if ($currentBranch -eq "main") { Err "main-guard" "running verify on main — use a feature branch (Rule 26/27)" }

# ---------------------------------------------------------------- 1. secret-scan
Write-Host "== secret-scan =="
if (Get-Command gitleaks -ErrorAction SilentlyContinue) {
  gitleaks detect --no-banner --redact
  if ($LASTEXITCODE -ne 0) { Err "secret-scan" "gitleaks found secrets" }
} elseif ($env:CI -eq "true" -or $env:GITHUB_ACTIONS) {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker run --rm -v "${RepoRoot}:/repo:ro" -w /repo "$GitleaksImage" detect --no-banner --redact
    if ($LASTEXITCODE -eq 0) { Notice "secret-scan" "no secrets found (dockerized gitleaks v8.30.1)" }
    elseif ($LASTEXITCODE -eq 1) { Err "secret-scan" "dockerized gitleaks found secrets" }
    else { Err "secret-scan" "dockerized gitleaks exited with code $LASTEXITCODE (scanner/runtime error)" }
  } else {
    Err "secret-scan" "gitleaks is required in CI but docker is unavailable"
  }
} else {
  # (a) filename-based: private key / credential files must not be committed.
  #     Exclude dependency / generated dirs (node_modules, .venv, _repo_clone,
  #     dist, build, .cache, coverage) — library files there are not first-party.
  $excludeDirs = '[\\/](node_modules|\.git|audits[\\/]private|\.venv|_repo_clone|dist|build|\.cache|coverage|test|tests|__tests__)[\\/]'
  $badFiles = Get-ChildItem -Path $RepoRoot -Recurse -File -Force -Include *.p8,*.p12,*credential*,*.pem,*.key `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $excludeDirs }
  if ($badFiles) { Err "secret-scan" "secret files present: $($badFiles.FullName -join ', ')" }
  # (b) content-based: first-party code/config only, require an assigned value.
  #     Exclude dependency / generated dirs (now also test/tests/__tests__ —
  #     unit-test fixtures deliberately hardcode fake credential-shaped values
  #     to exercise env-var handling, which is not a leaked secret) +
  #     *.env.example / *.env.sample templates. test-integration.yml's
  #     `services:` block sets dummy values (test-secret, test-key,
  #     test-token, ...) for the CI Postgres/Redis containers used by
  #     integration tests — real secrets for that workflow come from GitHub
  #     Actions secrets, never literals.
  #     Split into two passes, mirroring verify.sh: source code (.ts/.js/.py)
  #     REQUIRES a quoted value — a real accidentally-committed secret is
  #     always a string literal, while an unquoted "value" here is a
  #     variable/expression reference (e.g. `SOME_KEY: process.env['X']`, or
  #     a ternary like `KEY: cond ? a : b`), never a hardcoded secret. Config
  #     files (.json/.env/.yml/.yaml/.toml/.sh) keep the quote OPTIONAL since
  #     unquoted `KEY=value` is the idiomatic, expected form there.
  $srcHits = Get-ChildItem -Path $RepoRoot -Recurse -File -Force `
    -Include *.ts,*.js,*.py -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $excludeDirs } |
    Where-Object { Select-String -Path $_.FullName -Pattern '(API_KEY|SECRET|PRIVATE_KEY|TOKEN|PASSWORD)\s*[=:]\s*["''][A-Za-z0-9/+_-]{8,}["'']' -Quiet }
  $cfgHits = Get-ChildItem -Path $RepoRoot -Recurse -File -Force `
    -Include *.json,*.env,*.yml,*.yaml,*.toml,*.sh -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $excludeDirs } |
    Where-Object { $_.Name -notmatch '\.env\.(example|sample)$' } |
    Where-Object { $_.Name -ne 'test-integration.yml' } |
    Where-Object { Select-String -Path $_.FullName -Pattern '(API_KEY|SECRET|PRIVATE_KEY|TOKEN|PASSWORD)\s*[=:]\s*["'']?[A-Za-z0-9][A-Za-z0-9/+_-]{7,}' -Quiet }
  $hits = @($srcHits) + @($cfgHits)
  if ($hits) { Err "secret-scan" "possible hardcoded secrets in: $($hits.FullName -join ', ')" }
}

# ---------------------------------------------------------------- 2. doc-freshness
Write-Host "== doc-freshness =="
if (-not (Test-Path (Join-Path $RepoRoot 'README.md'))) { Err "doc-freshness" "README.md missing" }
# Audit age is derived from the YYYY-MM-DD embedded in the required audit
# filename (Rule 6), never from LastWriteTime — a fresh clone/checkout
# stamps every file with the checkout time, so a stale audit would
# otherwise look freshly-modified and silently pass this gate every run.
$auditDates = Get-ChildItem -Path (Join-Path $RepoRoot 'audits') -File -Filter *.md -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '[\\/]audits[\\/]private[\\/]' } |
  ForEach-Object {
    if ($_.Name -match '^(\d{4}-\d{2}-\d{2})') { $Matches[1] }
  } | Sort-Object -Descending
if (-not $auditDates) {
  Err "doc-freshness" "no audit under audits/ matches the required YYYY-MM-DD_<Agent>_<Scope>_Audit.md naming convention (Rule 6)"
} else {
  $newestDate = [datetime]::ParseExact($auditDates[0], 'yyyy-MM-dd', $null)
  $age = ([datetime]::Now - $newestDate).Days
  if ($age -gt 30) { Err "doc-freshness" "newest audit ($($auditDates[0])) is $age days old (>30)" }
}
$baselinePath = Join-Path $RepoRoot 'docs/_baseline.json'
if (-not (Test-Path $baselinePath)) {
  $cnt = (Get-ChildItem -Path (Join-Path $RepoRoot 'docs') -Recurse -Filter *.md -ErrorAction SilentlyContinue).Count
  "{ `"md_count`": $cnt }" | Out-File $baselinePath -Encoding utf8
  Notice "doc-freshness" "captured docs baseline md_count=$cnt"
}
$base = 0
if (Test-Path $baselinePath) {
  $m = (Get-Content $baselinePath) -match '"md_count":\s*(\d+)'
  if ($m) { $base = [int]($Matches[1]) }
}
$cur = (Get-ChildItem -Path (Join-Path $RepoRoot 'docs') -Recurse -Filter *.md -ErrorAction SilentlyContinue).Count
if ($cur -lt $base) { Err "doc-freshness" "docs md count $cur < baseline $base (deletion without approval)" }

# ---------------------------------------------------------------- 3. build / test (adaptive)
Write-Host "== build / test =="
$PM = $null
if (Test-Path (Join-Path $RepoRoot 'pnpm-lock.yaml')) { $PM = 'pnpm' }
elseif (Test-Path (Join-Path $RepoRoot 'yarn.lock')) { $PM = 'yarn' }
elseif (Test-Path (Join-Path $RepoRoot 'package-lock.json')) { $PM = 'npm' }

function RunTimed($secs, $label, $cmd) {
  # `Start-Process -Wait` blocks indefinitely regardless of $secs and never
  # produces a distinct timeout exit code — the previous version's timeout
  # was a no-op. Start without -Wait, bound the wait with WaitForExit, and
  # kill + report explicitly if the process is still running past $secs.
  $p = Start-Process -NoNewWindow -PassThru $cmd[0] $cmd[1..($cmd.Count-1)]
  $exited = $p.WaitForExit($secs * 1000)
  if (-not $exited) {
    try { $p.Kill() } catch {}
    Err $label "timed out after ${secs}s (likely network/install hang)"
    return
  }
  if ($p.ExitCode -ne 0) { Err $label "failed (rc=$($p.ExitCode))" }
  else { Notice $label "ok" }
}

if ($PM) {
  switch ($PM) {
    'pnpm' { RunTimed 300 build @('pnpm','install','--frozen-lockfile') }
    'yarn' { RunTimed 300 build @('yarn','install','--frozen-lockfile') }
    'npm'  { RunTimed 300 build @('npm','ci') }
  }
  if (-not $failed) {
    foreach ($m in @('npm','pnpm','yarn')) {
      if (Get-Command $m -ErrorAction SilentlyContinue) {
        $c = if ($m -eq 'npm') { 'npm run build --if-present' } elseif ($m -eq 'pnpm') { 'pnpm run build --if-present' } else { 'yarn build' }
        Invoke-Expression $c >$null 2>&1; if ($LASTEXITCODE -eq 0) { Notice build "build ok" } else { Err build "build failed" }
        $c = if ($m -eq 'npm') { 'npm test --if-present' } elseif ($m -eq 'pnpm') { 'pnpm test --if-present' } else { 'yarn test' }
        Invoke-Expression $c >$null 2>&1; if ($LASTEXITCODE -eq 0) { Notice test "test ok" } else { Err test "test failed" }
      }
    }
  }
} elseif ((Test-Path (Join-Path $RepoRoot 'pyproject.toml')) -or (Test-Path (Join-Path $RepoRoot 'requirements.txt'))) {
  if (Test-Path (Join-Path $RepoRoot 'requirements.txt')) { pip install -q -r (Join-Path $RepoRoot 'requirements.txt') }
  pytest -q; if ($LASTEXITCODE -ne 0) { Err "test" "pytest failed" }
} elseif (Test-Path (Join-Path $RepoRoot 'Cargo.toml')) {
  cargo build --release; if ($LASTEXITCODE -ne 0) { Err "build" "cargo build failed" }
  cargo test --release; if ($LASTEXITCODE -ne 0) { Err "test" "cargo test failed" }
} else {
  Notice "build" "no build system detected; docs/static repo — skipping build/test"
}

# ---------------------------------------------------------------- 4. deploy-dry
Write-Host "== deploy-dry =="
if (Test-Path (Join-Path $RepoRoot 'vercel.json')) {
  vercel build --dry-run; if ($LASTEXITCODE -ne 0) { Err "deploy" "vercel dry-run failed" }
} elseif ((Test-Path (Join-Path $RepoRoot 'railway.json')) -or (Test-Path (Join-Path $RepoRoot 'railway.toml'))) {
  Notice "deploy" "railway target present; run 'railway up --detach' manually"
} elseif (Test-Path (Join-Path $RepoRoot 'eas.json')) {
  npx eas build --platform all --local --no-wait --non-interactive; if ($LASTEXITCODE -ne 0) { Err "deploy" "eas dry build failed" }
} elseif (Test-Path (Join-Path $RepoRoot 'netlify.toml')) {
  Notice "deploy" "netlify target present; manual deploy"
} else {
  Notice "deploy" "no deploy target; smoke build already covered"
}

# ---------------------------------------------------------------- 5. directive-lint
# REPO_DIRECTIVE.md is the goal-layer constitution. Every task must trace to a
# Phase/Sprint/Epic id defined in the same file. Orphan tasks = divergence risk.
# ROLLOUT NOTE: missing directive is a Notice (not Err) during P8 rollout so
# repos without one yet don't red-break main. Flip to Err once every portfolio
# repo has a linted REPO_DIRECTIVE.md (see project-sentinel P8).
Write-Host "== directive-lint =="
$dirFile = Join-Path $RepoRoot 'REPO_DIRECTIVE.md'
if (-not (Test-Path $dirFile)) {
  Notice "directive-lint" "REPO_DIRECTIVE.md not present yet (required after P8 rollout)"
} else {
  # Collect defined ids ONLY from heading declarations ("### P1 — ...",
  # "### S1 (maps to P6) — ...", "### E1 — ..."), never from anywhere else in
  # the file. Matching the whole document (the previous approach) would pick
  # up every ID a task's own `traces-to:` line mentions — including a
  # made-up one — so any reference always "found itself" and no orphan could
  # ever be caught.
  $text = Get-Content $dirFile -Raw
  $defined = [regex]::Matches($text, '(?m)^### (P[0-9]+|S[0-9]+|E[0-9]+)\b') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  $orphans = $false
  $taskLines = Select-String -Path $dirFile -Pattern '^\s*- \[ \] T[0-9]+' | ForEach-Object { $_.Line }
  foreach ($line in $taskLines) {
    if ($line -notmatch 'traces-to:') {
      Err "directive-lint" "orphan task (no traces-to): $($line.Substring(0, [Math]::Min(80,$line.Length)))"
      $orphans = $true
    } else {
      # Validate EVERY slash-delimited id (e.g. all of P7, S2, E1 in
      # "traces-to: P7/S2/E1"), not just the first — the previous version
      # only checked the first segment, so "P7/S999/E999" passed as long
      # as P7 existed.
      $refs = ([regex]::Match($line, 'traces-to:([^|]*)')).Groups[1].Value.Trim() -split '/'
      foreach ($ref in $refs) {
        if ([string]::IsNullOrWhiteSpace($ref)) { continue }
        if ($defined -notcontains $ref) {
          Err "directive-lint" "task references undefined id '$ref': $($line.Substring(0, [Math]::Min(80,$line.Length)))"
          $orphans = $true
        }
      }
    }
  }
  if (-not $orphans) { Notice "directive-lint" "all tasks trace to a defined phase/sprint/epic" }
}

if ($failed) { Write-Host "VERIFY FAILED"; exit 1 }
Write-Host "VERIFY PASSED"
