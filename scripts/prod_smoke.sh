#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAILURES=0
WARNINGS=0

pass() { echo "PASS: $1"; }
warn() { echo "WARN: $1"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }

get_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    BEGIN { FS = "=" }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ ("^[[:space:]]*" key "=")) {
        sub("^[[:space:]]*" key "=", "", line)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        print line
      }
    }
  ' "$file" | tail -n 1
}

curl_status() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000"
}

if docker compose -f docker-compose.prod.yml ps >/dev/null 2>&1; then
  pass "docker compose responds"
else
  fail "docker compose is not available for the production stack"
fi

backend_status="$(docker compose -f docker-compose.prod.yml ps --format json backend 2>/dev/null || true)"
if printf '%s' "$backend_status" | grep -q '"Health":"healthy"'; then
  pass "backend container is healthy"
elif printf '%s' "$backend_status" | grep -q '"State":"running"'; then
  warn "backend container is running but not yet healthy"
else
  fail "backend container is not running"
fi

if docker compose -f docker-compose.prod.yml exec -T backend sh -lc 'aider --version' >/dev/null 2>&1; then
  pass "backend container aider command runs"
else
  fail "backend container aider command failed"
fi

internal_health_status="$(docker compose -f docker-compose.prod.yml exec -T backend sh -lc "node -e \"require('http').get('http://localhost:3000/health', r => { console.log(r.statusCode); process.exit(0); }).on('error', () => process.exit(1))\"" 2>/dev/null || true)"
if [ "$internal_health_status" = "200" ]; then
  pass "backend container /health returns 200"
else
  fail "backend container /health returned ${internal_health_status:-000}"
fi

internal_ready_status="$(docker compose -f docker-compose.prod.yml exec -T backend sh -lc "node -e \"require('http').get('http://localhost:3000/ready', r => { console.log(r.statusCode); process.exit(0); }).on('error', () => process.exit(1))\"" 2>/dev/null || true)"
if [ "$internal_ready_status" = "200" ]; then
  pass "backend container /ready returns 200"
else
  fail "backend container /ready returned ${internal_ready_status:-000}"
fi

public_domain="$(get_env_value ".env" "PUBLIC_DOMAIN" 2>/dev/null || true)"
if [ -n "${public_domain//[[:space:]]/}" ]; then
  public_health="$(curl_status "https://${public_domain}/health")"
  if [ "$public_health" = "200" ]; then
    pass "public /health returns 200"
  else
    fail "public /health returned $public_health"
  fi

  public_ready="$(curl_status "https://${public_domain}/ready")"
  if [ "$public_ready" = "200" ]; then
    pass "public /ready returns 200"
  else
    fail "public /ready returned $public_ready"
  fi
else
  warn "PUBLIC_DOMAIN is not set in .env; skipping public endpoint checks"
fi

github_token="$(get_env_value "backend/.env" "GITHUB_TOKEN" 2>/dev/null || true)"
if [ -n "${github_token//[[:space:]]/}" ]; then
  github_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${github_token}" \
    -H 'Accept: application/vnd.github+json' \
    https://api.github.com/user 2>/dev/null || echo "000")"
  if [ "$github_status" = "200" ]; then
    pass "GitHub token auth returns 200"
  else
    fail "GitHub token auth returned $github_status"
  fi
else
  fail "backend/.env is missing GITHUB_TOKEN"
fi

vercel_token="$(get_env_value "backend/.env" "VERCEL_TOKEN" 2>/dev/null || true)"
if [ -n "${vercel_token//[[:space:]]/}" ]; then
  vercel_status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${vercel_token}" \
    'https://api.vercel.com/v6/deployments?limit=1' 2>/dev/null || echo "000")"
  if [ "$vercel_status" = "200" ]; then
    pass "Vercel token can list deployments"
  elif [ "$vercel_status" = "403" ] || [ "$vercel_status" = "401" ]; then
    warn "Vercel token exists but deployment API returned $vercel_status"
  else
    warn "Vercel deployment probe returned $vercel_status"
  fi
else
  warn "VERCEL_TOKEN is not configured; Vercel build polling will stay disabled"
fi

slack_bot_id="$(get_env_value "backend/.env" "SLACK_BOT_ID" 2>/dev/null || true)"
if [ -n "${slack_bot_id//[[:space:]]/}" ]; then
  pass "SLACK_BOT_ID is configured"
else
  warn "SLACK_BOT_ID is not configured; Slack echo protection is degraded"
fi

echo
echo "Summary: $FAILURES failure(s), $WARNINGS warning(s)"
if [ "$FAILURES" -ne 0 ]; then
  exit 1
fi
