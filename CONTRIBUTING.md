# Contributing to Project Sentinel

## Before you start

Project Sentinel is in public beta. Before opening a PR:

1. Check [open issues](../../issues) to avoid duplicate work.
2. For large changes, open an issue first to discuss the approach.
3. Read [docs/QUICKSTART.md](docs/QUICKSTART.md) to get a local environment running.

## Development workflow

```bash
# Clone and set up
git clone https://github.com/<your-org>/project-sentinel.git
cd project-sentinel
cp backend/.env.example backend/.env   # fill in your values

# Start dependencies
docker compose up -d postgres redis

# Run backend tests
cd backend && npm ci && npm test

# Start UI dev server
cd ui && npm ci && npm run dev
```

## Code style

- **Backend**: Node.js 20, TypeScript (fully migrated 2026-07-17 — no `.js` files remain in `backend/src/`), pino logging. Run `npm test` and `npx tsc --noEmit` before committing.
- **UI**: Next.js 14 App Router, TypeScript, Tailwind. Run `npm run build` to catch type errors — it type-checks as part of the build.
- No Prettier/ESLint config is enforced currently — follow the existing style.

## Pull requests

- Keep PRs focused. One feature or fix per PR.
- Write tests for new backend logic (see `backend/test/` for examples).
- Update `backend/.env.example` if you add new environment variables.
- CI runs both `backend` (tests) and `ui` (build) jobs — both must pass.

## Adding a new command (works identically from Telegram and Slack)

Commands are verb-first (`audit <repo>`, no `/sentinel` prefix needed) and dispatch through `backend/src/commandRegistry.ts` to the same handler regardless of which platform the message came from.

1. Identify which sub-module it belongs to (`commands/reports.ts`, `commands/sprint.ts`, `commands/agents.ts`, `commands/repoOps.ts`, `commands/roundtable.ts`).
2. Add a new `case` to the appropriate module's handler function.
3. Add the verb-first alias entry to `commandRegistry.ts`'s alias table.
4. Add the command to the `help:*` section in `telegramCommands.ts`.
5. Update the command list in `README.md` under the relevant category.

See `docs/2026-07-22-slack-agent-roster-plan.md` for the full command-taxonomy design and the living implementation log.

## Security issues

See [SECURITY.md](SECURITY.md) for reporting security vulnerabilities.
