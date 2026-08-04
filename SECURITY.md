# Security Policy

## Supported versions

Only the latest version on `main` receives security fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email: **obsidianmedia.yt@gmail.com**

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any suggested fixes (optional but appreciated)

You will receive a response within 48 hours. Once confirmed, a fix will be released and you will be credited in the release notes (unless you prefer to remain anonymous).

## Security model

Project Sentinel is a self-hosted tool. Your security posture depends on:

- **`SENTINEL_UI_KEY`** — required in production. Protects the REST API from unauthenticated access. Generate with `openssl rand -hex 32`.
- **`GITHUB_WEBHOOK_SECRET`** — validates GitHub webhook payloads. Required.
- **`DEBUGGER_SHARED_SECRET`** — validates Telegram webhook payloads. Required.
- **Database URL** — keep `DATABASE_URL` private. In the standard self-hosted Oracle Cloud deploy (see `docs/ORACLE_DEPLOY.md`), Postgres runs as a Docker Compose service with no port published to the host/internet — only reachable from the `backend`/`ui` containers on the compose network.
- **AI provider keys** — treat these as secrets. They grant API spending access to your accounts.

## Known limitations

- Telegram commands are not authenticated per-user — anyone in your Telegram group can issue `/sentinel` commands.
- The UI has no role-based access control. `SENTINEL_UI_KEY` is a single shared secret.
