"use strict";
/**
 * Scoped environment for child processes (aider / claude).
 *
 * Security: never spread the entire `process.env` into a spawned builder.
 * Pass only an explicit allowlist plus the provider keys the builder needs.
 * This prevents leaking unrelated secrets (DB_URL, TELEGRAM_TOKEN, SENTRY_DSN…)
 * into the AI subprocess's environment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChildEnv = buildChildEnv;
// Baseline vars every child needs to function (PATH/HOME/NODE_ENV/LOCALE…).
const BASE_ALLOWED = [
    'PATH',
    'HOME',
    'USER',
    'NODE_ENV',
    'LANG',
    'LC_ALL',
    'TERM',
    'TMPDIR',
    'TEMP',
    'TMP',
];
// Provider / build keys the runners legitimately inject into the child.
const PROVIDER_KEYS = [
    'NVIDIA_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'DASHSCOPE_API_KEY',
    'DEEPSEEK_API_KEY',
    'GITHUB_TOKEN',
    'AIDER_MODEL',
    'BUILD_MODEL',
    'AUDIT_MODEL',
];
const ALLOWED_CHILD_ENV = [...BASE_ALLOWED, ...PROVIDER_KEYS];
function buildChildEnv(extra = {}) {
    const scoped = {};
    for (const key of ALLOWED_CHILD_ENV) {
        if (process.env[key] !== undefined) {
            scoped[key] = process.env[key];
        }
    }
    // Allow callers to override/add specific keys (e.g. OPENAI_API_BASE).
    for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined)
            scoped[k] = v;
    }
    return scoped;
}
//# sourceMappingURL=childEnv.js.map