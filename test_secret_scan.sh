#!/usr/bin/env bash
grep -rIlE "(API_KEY|SECRET|PRIVATE_KEY|TOKEN|PASSWORD)[[:space:]]*[=:][[:space:]]*[\"'][A-Za-z0-9/+_-]{8,}[\"']" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=audits/private \
  --exclude-dir=.venv --exclude-dir=_repo_clone --exclude-dir=dist --exclude-dir=build \
  --exclude-dir=.cache --exclude-dir=coverage \
  --exclude-dir=test --exclude-dir=tests --exclude-dir=__tests__ \
  --exclude="*.env" \
  --include="*.ts" --include="*.js" --include="*.py" . 2>/dev/null || true