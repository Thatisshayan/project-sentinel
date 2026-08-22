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
        if (line ~ /^".*"$/ || line ~ /^'\''.*'\''$/) {
          line = substr(line, 2, length(line) - 2)
        }
        print line
      }
    }
  ' "$file" | tail -n 1
}

check_file() {
  local file="$1"
  if [ -f "$file" ]; then
    pass "$file exists"
  else
    fail "$file is missing"
  fi
}

check_key() {
  local file="$1"
  local key="$2"
  local label="$3"
  local value=""
  if [ -f "$file" ]; then
    value="$(get_env_value "$file" "$key")"
  fi
  if [ -n "${value//[[:space:]]/}" ]; then
    pass "$label"
  else
    fail "$label"
  fi
}

check_command() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    pass "$command_name is installed"
  else
    fail "$command_name is not installed"
  fi
}

check_file ".env"
check_file "backend/.env"
check_file "ui/.env"

check_command git
check_command docker

if docker compose version >/dev/null 2>&1; then
  pass "docker compose is available"
elif command -v docker-compose >/dev/null 2>&1; then
  pass "docker-compose is available"
else
  fail "docker compose plugin is not available"
fi

check_key ".env" "POSTGRES_PASSWORD" "root .env has POSTGRES_PASSWORD"
check_key ".env" "PUBLIC_DOMAIN" "root .env has PUBLIC_DOMAIN"

for key in \
  GITHUB_WEBHOOK_SECRET \
  NOTION_API_KEY \
  NOTION_DATABASE_ID \
  TELEGRAM_BOT_TOKEN \
  TELEGRAM_CHAT_ID \
  DEBUGGER_SHARED_SECRET \
  GITHUB_ORG \
  SENTINEL_UI_KEY \
  GITHUB_TOKEN
do
  check_key "backend/.env" "$key" "backend/.env has $key"
done

check_key "ui/.env" "SENTINEL_API_URL" "ui/.env has SENTINEL_API_URL"
check_key "ui/.env" "SENTINEL_UI_KEY" "ui/.env has SENTINEL_UI_KEY"

backend_ui_key="$(get_env_value "backend/.env" "SENTINEL_UI_KEY" 2>/dev/null || true)"
frontend_ui_key="$(get_env_value "ui/.env" "SENTINEL_UI_KEY" 2>/dev/null || true)"
if [ -n "${backend_ui_key//[[:space:]]/}" ] && [ -n "${frontend_ui_key//[[:space:]]/}" ]; then
  if [ "$backend_ui_key" = "$frontend_ui_key" ]; then
    pass "backend/ui SENTINEL_UI_KEY values match"
  else
    fail "backend/ui SENTINEL_UI_KEY values do not match"
  fi
fi

provider_keys=(
  NVIDIA_API_KEY
  GEMINI_API_KEY
  MISTRAL_API_KEY
  OPENROUTER_API_KEY
  DASHSCOPE_API_KEY
  DEEPSEEK_API_KEY
  ANTHROPIC_API_KEY
  OPENAI_API_KEY
)

has_provider_key=0
for key in "${provider_keys[@]}"; do
  value="$(get_env_value "backend/.env" "$key" 2>/dev/null || true)"
  if [ -n "${value//[[:space:]]/}" ]; then
    has_provider_key=1
    break
  fi
done

if [ "$has_provider_key" -eq 1 ]; then
  pass "backend/.env has at least one AI provider key"
else
  fail "backend/.env has no AI provider key; audits/chat/build fixes will not run"
fi

if command -v aider >/dev/null 2>&1; then
  if aider --version >/dev/null 2>&1; then
    pass "aider command runs"
  else
    fail "aider is installed but aider --version failed"
  fi
else
  fail "aider command is not installed or not on PATH"
fi

if [ -f "$HOME/.docker/config.json" ] && grep -q 'ghcr.io' "$HOME/.docker/config.json" 2>/dev/null; then
  pass "docker client has a ghcr.io login entry"
else
  warn "docker client has no visible ghcr.io login entry; image pulls may fail"
fi

if docker compose -f docker-compose.prod.yml config >/dev/null 2>&1; then
  pass "docker-compose.prod.yml resolves successfully"
else
  fail "docker-compose.prod.yml does not resolve cleanly with the current env files"
fi

echo
echo "Summary: $FAILURES failure(s), $WARNINGS warning(s)"
if [ "$FAILURES" -ne 0 ]; then
  exit 1
fi
