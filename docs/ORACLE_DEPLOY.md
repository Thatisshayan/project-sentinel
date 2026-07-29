# Deploying to Oracle Cloud (Always Free VM)

Replaces the Railway setup (see git history for `RAILWAY_SETUP.md` /
`backend/railway.toml` / `ui/railway.toml` if you need the old process).

Assumes you already have an Oracle Cloud account and an Always Free
Ampere/x86 VM instance running Ubuntu, and a domain you can point at it.

## 1. DNS

Point an A record for your chosen hostname (e.g. `sentinel.yourdomain.com`)
at the VM's public IP. Give it a few minutes to propagate before step 5
(Caddy needs it resolvable to issue a Let's Encrypt certificate).

## 2. Open the ports

Oracle blocks traffic at two layers — both need opening:

- **VCN Security List / NSG** (OCI console → Networking → Virtual Cloud
  Networks → your VCN → Security Lists): add ingress rules for TCP 80 and
  443 from `0.0.0.0/0`.
- **Host firewall** (Oracle's Ubuntu images ship with `iptables` rules that
  block everything not explicitly allowed, even after the NSG is open):

  ```bash
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save
  ```

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

## 4. Clone the repo and configure environment

```bash
git clone <your-repo-url> project-sentinel
cd project-sentinel
cp backend/.env.example backend/.env
cp ui/.env.example ui/.env
```

Fill in `backend/.env` with your real values (Slack, Telegram, GitHub,
Notion, AI provider keys, etc. — see the comments in the file). Notably:

- `PUBLIC_DOMAIN` — the hostname from step 1, e.g. `sentinel.yourdomain.com`
  (no `https://`, no trailing slash). This drives both the webhook URL
  printed during repo onboarding and the Caddy TLS certificate.
- `SENTINEL_UI_KEY` — generate with `openssl rand -hex 32` and put the
  **same value** in `ui/.env`.
- `DATABASE_URL` / `REDIS_URL` — leave these out of `backend/.env`;
  `docker-compose.prod.yml` sets them itself to point at the `postgres` and
  `redis` containers.

Fill in `ui/.env`:

```
SENTINEL_API_URL=http://backend:3000
SENTINEL_UI_KEY=<same value as backend/.env>
```

Set a Postgres password (used only between containers, never exposed):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "PUBLIC_DOMAIN=sentinel.yourdomain.com" >> .env
```

(`docker compose` auto-loads a `.env` file in the project root for variable
substitution inside `docker-compose.prod.yml`.)

## 5. Bring up the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f caddy
```

Watch the Caddy logs until it reports the certificate was obtained. Then
check:

```bash
curl -I https://sentinel.yourdomain.com/health
```

## 6. Re-point external webhooks

- **GitHub**: repos onboarded before the migration have their webhook URL
  pointed at the old Railway host — either re-run onboarding (it reads
  `PUBLIC_DOMAIN` now) or manually edit each repo's Settings → Webhooks →
  Payload URL to `https://sentinel.yourdomain.com/webhook/github`.
- **Slack**: api.slack.com → your app → Event Subscriptions / Interactivity
  → update the Request URL to `https://sentinel.yourdomain.com/webhook`.
- **Telegram**: if using a webhook (not polling) for the bot, re-run the
  `setWebhook` call with the new URL.

## 7. Cutover

Keep the Railway deployment running until you've confirmed the new host is
receiving and processing webhooks correctly (check `/health`, check that a
test push/PR shows up), then decommission the Railway services.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Backups

Postgres data lives in the `postgres_data` named volume. There's no
managed backup here (unlike Railway) — set up `scripts/backup_postgres.sh`
as a daily cron job:

```bash
cp scripts/backup_postgres.sh ~/backup_postgres.sh
chmod +x ~/backup_postgres.sh
(crontab -l 2>/dev/null; echo "17 3 * * * /home/ubuntu/backup_postgres.sh") | crontab -
```

Dumps land in `~/backups/sentinel_<timestamp>.sql.gz`, with a `backup.log`
tracking success/failure and 14 days of backups kept (older ones
auto-deleted). To restore:

```bash
gunzip -c ~/backups/sentinel_<timestamp>.sql.gz | \
  docker exec -i project-sentinel-postgres-1 psql -U sentinel sentinel
```

For a one-off manual dump instead of the cron job:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U sentinel sentinel | gzip > backup-$(date +%F).sql.gz
```
