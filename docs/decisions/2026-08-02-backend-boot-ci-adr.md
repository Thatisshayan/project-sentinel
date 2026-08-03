# 2026-08-02 Backend Boot + CI Smoke ADR

Status: accepted

## Context

`backend/src/index.ts` was acting as the bootstrap, server setup, and startup orchestration entrypoint in one file. That made the boot path harder to reason about and increased the risk of future startup regressions.

CI also lacked a repo-local UI e2e verification path. The gate validated backend governance and build/test health, but it did not exercise the built UI against a running server.

## Decision

Split the backend startup orchestration into `backend/src/startup.ts` and have `backend/src/index.ts` delegate to it.

Add a UI smoke-e2e path to the gate workflow using a repo-local Node script that starts the built UI and checks representative routes.

## Consequences

- `index.ts` is smaller and easier to audit.
- Boot responsibilities now live in a dedicated startup module.
- CI now exercises the built UI through a runtime smoke path instead of only compile-time validation.
- The smoke test is intentionally lightweight; it checks availability and route rendering, not full browser interaction.

## Follow-up

- If full browser coverage becomes necessary, add a dedicated Playwright-based workflow once the dependency and runtime cost are justified.
