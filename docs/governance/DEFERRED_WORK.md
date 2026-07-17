# Deferred Work Register

> Updated: 2026-07-17
> Agent: Codex
> Last audit: `audits/17.07.2026CodexPhase2Audit.md`

---

## Deferred Items

### D-001: ESLint TypeScript support
**Scope**: Linting disabled for all `.ts` files
**Reason blocked**: `@typescript-eslint/parser v8.x` is incompatible with TypeScript 7 (expects TS < 6.1.0). Locked by npm dependency chain.
**Impact**: No lint coverage for TypeScript files. JS files linted normally.
**Proposed resolution**: 
- Option A: Upgrade to `@typescript-eslint` v8.0+ when compatible with TS7 drops
- Option B: Use `--ext .ts` flag + disable `@typescript-eslint` rules (lint-only, no TS rules)
- Option C: Accept lint-only-JS for now, re-enable when ecosystem catches up
**Status**: Deferred — requires ecosystem update

---

## Completed Work (no action needed)

- ✅ TypeScript migration complete (Phase 1) — all .js → .ts
- ✅ AppError taxonomy implemented (Phase 2 Task 2.1)
- ✅ Global error handlers fixed with Sentry v8+ (Phase 2 Tasks 2.2, 2.4)
- ✅ Logger.error pattern fixed (Phase 2 Task 2.3) — 67 occurrences
- ✅ Structured error responses via Express middleware (Phase 2 Task 2.5)

---

## Notes for Future Agents

- Phase 2 error architecture is complete. The `AppError` class hierarchy in `src/errors/errors.ts` is the canonical error type. All new errors should subclass `AppError`.
- Lint for `.ts` files is temporarily disabled. Do not re-enable until `@typescript-eslint` releases a version compatible with TypeScript 7.
- The `.eslintrc.json` ignores `**/*.ts` via `ignorePatterns`. When lint for TS is re-enabled, remove `**/*.ts` from `ignorePatterns`.