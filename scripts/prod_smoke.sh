#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAILURES=0
WARNINGS=0
STARTUP_WAIT_SECONDS="${STARTUP_WAIT_SECONDS:-60}"

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

backend_compose_ps() {
  docker compose -f docker-compose.prod.yml ps --format json backend 2>/dev/null || true
}

wait_for_backend_health() {
  local attempts="$1"
  local state=""
  local health=""
  local status=""

  for _ in $(seq 1 "$attempts"); do
    status="$(backend_compose_ps)"
    if printf '%s' "$status" | grep -q '"Health":"healthy"'; then
      echo "healthy"
      return 0
    fi
    if ! printf '%s' "$status" | grep -q '"State":"running"'; then
      echo "not-running"
      return 1
    fi
    sleep 1
  done

  status="$(backend_compose_ps)"
  if printf '%s' "$status" | grep -q '"Health":"healthy"'; then
    echo "healthy"
    return 0
  fi
  if printf '%s' "$status" | grep -q '"Health":"starting"'; then
    echo "starting"
    return 1
  fi
  if printf '%s' "$status" | grep -q '"State":"running"'; then
    echo "running"
    return 1
  fi
  echo "not-running"
  return 1
}

probe_backend_http_status() {
  local path="$1"
  docker compose -f docker-compose.prod.yml exec -T backend sh -lc \
    "node -e \"require('http').get('http://localhost:3000${path}', r => { console.log(r.statusCode); process.exit(0); }).on('error', () => process.exit(1))\"" \
    2>/dev/null || true
}

wait_for_backend_http_status() {
  local path="$1"
  local expected="$2"
  local attempts="$3"
  local last_status="000"

  for _ in $(seq 1 "$attempts"); do
    last_status="$(probe_backend_http_status "$path")"
    if [ "$last_status" = "$expected" ]; then
      echo "$last_status"
      return 0
    fi
    sleep 1
  done

  echo "${last_status:-000}"
  return 1
}

if docker compose -f docker-compose.prod.yml ps >/dev/null 2>&1; then
  pass "docker compose responds"
else
  fail "docker compose is not available for the production stack"
fi

backend_health="$(wait_for_backend_health "$STARTUP_WAIT_SECONDS")"
if [ "$backend_health" = "healthy" ]; then
  pass "backend container is healthy"
elif [ "$backend_health" = "starting" ] || [ "$backend_health" = "running" ]; then
  warn "backend container is running but not yet healthy after ${STARTUP_WAIT_SECONDS}s"
else
  fail "backend container is not running"
fi

if docker compose -f docker-compose.prod.yml exec -T backend sh -lc 'aider --version' >/dev/null 2>&1; then
  pass "backend container aider command runs"
else
  fail "backend container aider command failed"
fi

internal_health_status="$(wait_for_backend_http_status "/health" "200" "$STARTUP_WAIT_SECONDS")"
if [ "$internal_health_status" = "200" ]; then
  pass "backend container /health returns 200"
else
  fail "backend container /health returned ${internal_health_status:-000}"
fi

internal_ready_status="$(wait_for_backend_http_status "/ready" "200" "$STARTUP_WAIT_SECONDS")"
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
