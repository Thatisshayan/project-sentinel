# GitHub Vulnerability Triage Audit

- Date: 2026-08-22
- Agent: Codex
- Scope: Triage and remediate the 29 open GitHub Dependabot alerts in `Thatisshayan/project-sentinel`

## Summary

I pulled the live Dependabot alert list from GitHub and reduced the 29 alerts into 5 dependency clusters:

- `next` (21 alerts, `ui`)
- `postcss` (4 alerts, `ui`)
- `glob` (1 alert, `ui`)
- `js-yaml` (2 alerts, `backend`)
- `@opentelemetry/core` via `@sentry/node` (1 alert, `backend`)

All 29 GitHub alerts were addressed in the repo's dependency graph in this pass by:

- upgrading `ui` to `next@15.5.21` and `eslint-config-next@15.5.21`
- pinning/overriding `postcss@8.5.23` and `glob@10.5.0` in `ui`
- upgrading `backend` to `@sentry/node@10.70.0` to move onto OpenTelemetry 2.x
- overriding backend `js-yaml` resolutions to `4.3.1` and `3.15.1`

## Per-Alert Triage

| Alert | Package | Manifest | Severity | Patched In | Outcome |
| --- | --- | --- | --- | --- | --- |
| #1 | `@opentelemetry/core` | `backend/package-lock.json` | medium | `2.8.0` | Fixed in repo by upgrading `@sentry/node` to `10.70.0`, resolving `@opentelemetry/core@2.10.0`. |
| #6 | `js-yaml` | `backend/package-lock.json` | high | `4.3.1` | Fixed in repo with backend override to `js-yaml@4.3.1`. |
| #7 | `js-yaml` | `backend/package-lock.json` | high | `3.15.1` | Fixed in repo with targeted override for `@istanbuljs/load-nyc-config -> js-yaml@3.15.1`. |
| #8 | `glob` | `ui/package-lock.json` | high | `10.5.0` | Fixed in repo with `glob@10.5.0` override. |
| #9 | `next` | `ui/package-lock.json` | medium | `15.5.10` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #10 | `next` | `ui/package-lock.json` | high | `15.0.8` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #11 | `next` | `ui/package-lock.json` | medium | `15.5.13` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #12 | `next` | `ui/package-lock.json` | medium | `15.5.14` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #13 | `next` | `ui/package-lock.json` | high | `15.5.15` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #14 | `postcss` | `ui/package-lock.json` | medium | `8.5.10` | Fixed in repo by pinning/overriding `postcss@8.5.23`. |
| #15 | `next` | `ui/package-lock.json` | high | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #16 | `next` | `ui/package-lock.json` | high | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #17 | `next` | `ui/package-lock.json` | medium | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #18 | `next` | `ui/package-lock.json` | high | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #19 | `next` | `ui/package-lock.json` | medium | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #20 | `next` | `ui/package-lock.json` | medium | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #21 | `next` | `ui/package-lock.json` | low | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #22 | `next` | `ui/package-lock.json` | medium | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #23 | `next` | `ui/package-lock.json` | low | `15.5.16` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #34 | `next` | `ui/package-lock.json` | high | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #35 | `next` | `ui/package-lock.json` | medium | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #36 | `next` | `ui/package-lock.json` | high | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #37 | `next` | `ui/package-lock.json` | medium | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #38 | `next` | `ui/package-lock.json` | medium | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #39 | `next` | `ui/package-lock.json` | medium | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #40 | `next` | `ui/package-lock.json` | high | `15.5.21` | Fixed in repo by upgrading `next` to `15.5.21`. |
| #41 | `postcss` | `ui/package-lock.json` | high | `8.5.12` | Fixed in repo by pinning/overriding `postcss@8.5.23`. |
| #42 | `postcss` | `ui/package-lock.json` | high | `8.5.18` | Fixed in repo by pinning/overriding `postcss@8.5.23`. |
| #49 | `postcss` | `ui/package-lock.json` | medium | `8.5.23` | Fixed in repo by pinning/overriding `postcss@8.5.23`. |

## Code / Manifest Changes

- `backend/package.json`
  - `@sentry/node` upgraded from `^8.55.2` to `^10.70.0`
  - added overrides for `js-yaml@4.3.1` and `@istanbuljs/load-nyc-config -> js-yaml@3.15.1`
- `backend/package-lock.json`
  - resolves `@opentelemetry/core@2.10.0`
  - resolves `js-yaml@4.3.1` and `3.15.1`
- `backend/src/index.ts`
  - removed stale `enableTracing` option no longer accepted by current Sentry types
- `backend/test/childEnv.test.ts`
  - fixed an environment-dependent test assumption uncovered during verification
- `ui/package.json`
  - upgraded `next` to `15.5.21`
  - upgraded `eslint-config-next` to `15.5.21`
  - pinned `postcss` to `8.5.23`
  - added overrides for `postcss` and `glob`
- `ui/package-lock.json`
  - resolves `next@15.5.21`, `postcss@8.5.23`, `glob@10.5.0`
- `ui/app/layout.tsx`
  - replaced Google-hosted `Inter` fetch with the already-committed local `GeistVF.woff` asset to keep builds offline-safe

## Verification

Completed:

- `gh api "repos/Thatisshayan/project-sentinel/dependabot/alerts?state=open&per_page=100"` to collect the live 29-alert backlog
- `npm ls @sentry/node @opentelemetry/core js-yaml --all` in `backend`
- `npm ls next postcss glob --all` in `ui`
- `npm run typecheck` in `backend` — passed after removing stale Sentry `enableTracing`
- focused test verification: `backend/test/childEnv.test.ts` failure reproduced, fixed, and rerun successfully within the full suite output
- `npm audit --json` post-change in both `backend` and `ui`

Observed but not cleanly completed before this session ended:

- `npm test` in `backend`
  - initial rerun showed the pre-existing `childEnv` failure
  - after the fix, the rerun continued with many passing suites and no repeat of `childEnv`, but I stopped the long-running session before a final Jest exit summary
- `npm run build` in `ui`
  - before the font fix it failed with `next/font` trying to fetch `Inter` from Google Fonts
  - after switching to a local font asset, the rerun did not emit a new error before I stopped the long-running build session, so final build success remains unconfirmed in this audit

## Residual Risk / Deferred

The original 29 GitHub alerts were remediated in the repo dependency graph, but post-change `npm audit` still reports separate residual vulnerabilities not part of that GitHub backlog:

- `ui`: 10 vulnerabilities involving `next -> sharp`, `brace-expansion`, `body-parser`, `hono`, `@hono/node-server`, `fast-uri`, `ip-address`, `js-yaml`, and `nanoid`
- `backend`: 1 high-severity residual vulnerability in `brace-expansion`

Those are recorded as deferred follow-up work in `docs/governance/DEFERRED_WORK.md`.
