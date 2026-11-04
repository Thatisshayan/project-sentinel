# CI Unblock / Dependency Vulnerability Audit

- Date: 2026-11-03
- Agent: Claude (Claude Code, Opus 5.5)
- Scope: Why every open Dependabot PR (#164-#183) fails `CI` and `governance-gate`
- traces-to: P4, P8

## Summary

Every open Dependabot PR was red, but none of the failures were caused by the
PRs themselves. Both failures were inherited from `main`, which had not had a
non-Dependabot commit since 2026-09-17 (#124):

| Check | Failing step | Root cause |
| --- | --- | --- |
| `CI` / `backend` job | `npm audit --audit-level=high --production` | 7 advisories had landed against backend deps on `main` (3 critical, 3 high, 1 moderate). Because the job audits `backend/` regardless of what the PR touches, even `ui/`-only bumps failed. |
| `governance-gate` | `scripts/verify.sh` -> `doc-freshness` | Newest dated audit under `audits/` was `2026-08-22` (73 days old, limit 30). Purely time-based: `main` itself would fail the same way. |

Everything else in the gate (secret-scan, build/test for backend and ui,
deploy-dry, directive-lint) was green on the sampled PR (#183).

## Remediation

1. `npm audit fix` (non-breaking) in `backend/` - cleared the high-severity
   `follow-redirects` / `proxy-addr` / related advisories via lockfile only.
2. One critical remained that `audit fix` cannot apply: `simple-git` 3.x
   (command execution via unsafe-operation guard bypasses, residual of
   CVE-2026-28291; plus `@simple-git/argv-parser` `VISUAL` editor bypass).
   Patched only in `simple-git@4`. Upgraded `^3.22.0` -> `^4.0.2`.
3. `simple-git@4` drops the default export. Changed
   `import simpleGit from 'simple-git'` to `import { simpleGit } from 'simple-git'`
   in the 7 source files that use it (`aiderRunner`, `claudeCodeAudit`,
   `securityPatcher`, `securityScanner`, `taskBuilder`, `obsidianLedgerWriter`,
   `utils/gitSync`) and `test/gitSync.test.ts`. Call sites are unchanged.
4. Updated the `jest.mock('simple-git', ...)` factories in
   `test/securityPatcher.policy.test.ts` and `test/obsidianLedgerWriter.test.ts`
   to return `{ simpleGit: fn }` instead of a bare function.
5. This file restores `doc-freshness`.

## Verification (local, Windows workstation)

- `npm audit --audit-level=high --omit=dev` -> exit 0
- `npx tsc --noEmit` -> clean
- `npx jest` -> 74 suites / 604 tests passed
- `test/gitSync.test.ts` exercises real git through `simple-git@4` (rebase +
  conflict-abort) and passes. Note: it can exceed Jest's 5s default on a cold
  Windows run; it passes with a longer timeout and is not a v4 regression.

## Remaining / Not Fixed

- `qs` <=6.16 (moderate, via `express@4`) - below the CI `high` threshold, left
  for the Dependabot `qs` bump.
- `backend` `npm run lint` errors with "No files matching the pattern src/" -
  pre-existing, not run by CI (only `ui` lints). Worth a follow-up.
- The 30-day `doc-freshness` gate will go red again on ~2026-12-03 unless a new
  dated audit lands. Any long quiet period on `main` blocks all PRs, including
  security bumps. Consider exempting Dependabot PRs or turning age into a
  warning on PRs and an error only on scheduled runs.
- After this merges, the open Dependabot PRs need a rebase (`@dependabot rebase`)
  to pick up the fix; several may be superseded by the lockfile refresh.
