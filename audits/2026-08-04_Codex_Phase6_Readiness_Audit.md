# 2026-08-04 Codex Phase6 Readiness Audit

## Scope
- Repository state review focused on Phase 6 completion readiness, current doc drift, and provider-refactor risk.

## Summary
- The codebase already contains the shared UI helpers that TODO previously listed as Phase 6.5 work.
- The provider consolidation path in `backend/src/ai/client.ts` is real, shared, and semantically sensitive, so the deferred status for Phase 6.3 still makes sense.
- The repo docs had stale status text around both Docker availability and Phase 6.5.

## Findings
1. `TODO.md` still marked Phase 6.5 as pending even though the UI source already centralizes the helpers.
   - Evidence: `ui/lib/format.ts` exports `mapBuild` and `relativeTime`; `ui/lib/theme.ts` exports `agentColorForLabel`, `priorityColor`, and `scoreColor`.
   - Evidence: `ui/app/page.tsx`, `ui/app/repos/page.tsx`, `ui/app/repos/[name]/page.tsx`, `ui/components/sentinel/repo-row.tsx`, and `ui/components/sentinel/sprint-view.tsx` import those shared helpers instead of redefining them inline.

2. `STATUS.md` overstated the Docker blocker as “no Docker daemon in this environment.”
   - Evidence: `docker version` succeeds for the client, but the engine connection fails with `permission denied while trying to connect to the docker API`.
   - Conclusion: Docker is installed, but this shell still cannot reach the daemon, so integration tests remain blocked here for a narrower reason than the doc stated.

3. Phase 6.3 remains a legitimate deferred risk, not a generic cleanup task.
   - Evidence: `backend/src/ai/client.ts` centralizes fallback-provider execution across NVIDIA, Gemini, DashScope, DeepSeek, and optional Anthropic.
   - Evidence: callers such as `backend/src/claudeCodeAudit.ts`, `backend/src/sentinelBrain.ts`, `backend/src/sprintPlanner.ts`, `backend/src/agentRoom.ts`, `backend/src/ceoReport.ts`, `backend/src/owaspChecker.ts`, and `backend/src/telegramAI.ts` still rely on caller-specific prompts and downstream post-processing.
   - Risk: collapsing those paths blindly could alter retry behavior, provider attribution, output filtering, or model selection semantics across multiple workflows at once.

## Verification Performed
- Checked repository index status in codebase-memory-mcp: ready.
- Inspected architecture graph and direct source files for the Phase 6.3 and 6.5 surfaces.
- Verified Docker client/daemon behavior from this shell.

## Status
- Completed: repository audit for Phase 6 readiness, with docs synchronized for the findings above.
- Deferred: no code changes were made to the provider client yet; that should be handled incrementally, caller by caller.

