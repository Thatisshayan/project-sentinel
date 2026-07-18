/**
 * Scoped environment for child processes (aider / claude).
 *
 * Security: never spread the entire `process.env` into a spawned builder.
 * Pass only an explicit allowlist plus the provider keys the builder needs.
 * This prevents leaking unrelated secrets (DB_URL, TELEGRAM_TOKEN, SENTRY_DSN…)
 * into the AI subprocess's environment.
 */
export declare function buildChildEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined>;
//# sourceMappingURL=childEnv.d.ts.map