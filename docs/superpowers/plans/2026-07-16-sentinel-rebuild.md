# Project Sentinel — Complete Codebase Rebuild Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite reading:** `2026-07-16-DeepCodebaseAudit.md` (full audit findings), `TODO.md` (open P0-P2 items), `AGENTS.md` (agent pool configuration).

**Goal:** Transform Project Sentinel from a functional-but-fragile prototype into a production-grade autonomous agent system with TypeScript safety, 50%+ test coverage, structured error handling, hardened security, and operational excellence.

**Architecture:** 7 sequential phases — each phase leaves the system strictly better than it started. Foundation/CI comes first (safety net), then TypeScript migration (enables everything), followed by error architecture, security hardening, test blitz, catch-pattern elimination, architecture refactoring, and operational excellence.

**Tech Stack:** Node.js 20 → TypeScript 5 · Express · PostgreSQL · Redis/BullMQ · aider · Next.js 14 · Railway · Jest + testcontainers · Sentry · ESLint + Prettier

---

## Critical Dependencies Between Phases

```
Phase 0: Foundation (CI, lint, test infra, Sentry, execSync)
   │
   ├──> Phase 1: TypeScript Migration (needs CI + lint from Phase 0)
   │        │
   │        ├──> Phase 2: Error Architecture (needs TS types + Sentry from Phase 0-1)
   │        ├──> Phase 3: Security Hardening (independent — can overlap with Phases 1-2)
   │        │
   │        └──> Phase 4: Test Coverage Blitz (needs Phase 0 test infra + Phase 1 types)
   │                 │
   │                 └──> Phase 5: Catch Pattern Elimination (needs Phase 2 + Phase 4)
   │                          │
   │                          └──> Phase 6: Architecture Refactoring (needs Phase 4 tests + Phase 5 error safety)
   │
   └──> Phase 7: Operational Excellence (can start in parallel with Phase 3-4)
```

---

## Phase 0: Foundation & Safety Net

**Goal:** Build the safety infrastructure that every subsequent phase depends on. Nothing risky ships without a gate.

### Task 0.1: Overhaul CI to gate pull requests

**Files:**
- Modify: `.github/workflows/ci.yml`

**Details:** CI currently only runs on `push: main`. Add `pull_request:` trigger. Add matrix steps for lint, typecheck (once TS infra exists), and test coverage. Add npm cache.

- [ ] **Step 1:** Add `pull_request` and `pull_request_target` triggers alongside `push: main`

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

- [ ] **Step 2:** Add `npm run lint` and `npm run test:coverage` steps to both backend and UI jobs

- [ ] **Step 3:** Add dependency caching for `~/.npm`

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ hashFiles('**/package-lock.json') }}
    restore-keys: npm-
```

- [ ] **Step 4:** Add `SENTINEL_UI_KEY` env var to CI (set a non-empty placeholder) so auth-related tests pass

- [ ] **Step 5:** Commit and verify CI runs on a PR branch before merging

### Task 0.2: Add ESLint + Prettier to backend

**Files:**
- Create: `backend/eslint.config.mjs`
- Create: `backend/.prettierrc`
- Modify: `backend/package.json` (add `lint` and `format` scripts, add devDependencies)

- [ ] **Step 1:** Install ESLint flat config + Prettier

```bash
cd backend && npm install --save-dev eslint @eslint/js prettier eslint-config-prettier globals
```

- [ ] **Step 2:** Create `eslint.config.mjs` with Node.js rules, `require()` checking, no-unused-vars, no-undef

```js
import globals from 'globals';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  { files: ['src/**/*.js', 'src/**/*.ts'], ... },
  { languageOptions: { globals: globals.node } },
  { rules: { 'no-unused-vars': 'warn', 'no-undef': 'error' } },
];
```

- [ ] **Step 3:** Create `.prettierrc` matching project style

```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 4:** Add `lint` and `format` scripts to `package.json`

```json
"lint": "eslint src/",
"format": "prettier --write src/"
```

- [ ] **Step 5:** Add to CI: `run: npm run lint`

### Task 0.3: Fix `execSync` → async `spawn` (event loop blocker)

**Files:**
- Modify: `backend/src/taskBuilder.js` (lines 194-203)
- Modify: `backend/src/securityPatcher.js` (line 63)
- Modify: `backend/src/dependencyScanner.js` (line 21)
- Modify: `backend/src/index.js` (line 31, `probeTools`)
- Modify: `backend/src/commands/repoOps.js` (line 562)

**Why this is Phase 0:** These synchronous child_process calls block the entire Node process, including webhook handling, for up to 3 minutes during `npm ci`/`pip install`.

- [ ] **Step 1:** Create `src/utils/execAsync.ts` — a promisified `spawn` wrapper with timeout, stdout capture, stderr capture

```typescript
import { spawn, SpawnOptions } from 'child_process';

interface ExecResult { stdout: string; stderr: string; exitCode: number | null; }

export function execAsync(
  command: string,
  args: string[],
  options?: SpawnOptions & { timeout?: number }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
    child.on('error', reject);
    if (options?.timeout) {
      setTimeout(() => { child.kill(); reject(new Error(`Timeout after ${options.timeout}ms`)); }, options.timeout);
    }
  });
}
```

- [ ] **Step 2:** Replace each `execSync` call. Example for `taskBuilder.js`:

```typescript
// Before:
execSync('npm ci', { cwd: repoDir, timeout: 180000, stdio: 'inherit' });

// After:
const { exitCode, stderr } = await execAsync('npm', ['ci'], {
  cwd: repoDir, timeout: 180000
});
if (exitCode !== 0) throw new Error(`npm ci failed: ${stderr.slice(200)}`);
```

- [ ] **Step 3:** Do the same pattern for all 5 files listed above. Each gets the same treatment: `execSync` → `await execAsync` with proper error handling.

- [ ] **Step 4:** Run the existing test suite to confirm no regressions on mocked paths.

### Task 0.4: Setup Sentry error tracking

**Files:**
- Modify: `backend/package.json` (add `@sentry/node`)
- Modify: `backend/src/index.js` (initialize Sentry)
- Create: `backend/src/config.ts` (centralized env var access with validation)

- [ ] **Step 1:** Install Sentry

```bash
cd backend && npm install @sentry/node
```

- [ ] **Step 2:** Initialize Sentry at the top of `index.js` (before any other require)

```typescript
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
```

- [ ] **Step 3:** Add `SENTRY_DSN` to `.env.example` and CI env vars (optional, can be empty for local dev)

### Task 0.5: Add Pre-commit Hooks

**Files:**
- Create: `.husky/pre-commit`
- Create: `.husky/.gitignore`
- Modify: `package.json` (root — add `prepare` script if none)
- Modify: `.lintstagedrc.json` or `package.json` lint-staged config

- [ ] **Step 1:** Install husky + lint-staged

```bash
cd backend && npm install --save-dev husky lint-staged
npx husky init
```

- [ ] **Step 2:** Configure lint-staged to run ESLint + Prettier on staged `.js`/`.ts` files

- [ ] **Step 3:** Add a pre-commit hook that runs lint-staged

- [ ] **Step 4:** Add `backend/.husky/.gitignore` with `_/` to not commit the husky binary

### Task 0.6: Enforce branch protection on `main`

**Action:** This is a GitHub settings change, not code.

- [ ] **Step 1:** In GitHub repo Settings → Branches → Add branch protection rule for `main`:
  - Require pull request before merging
  - Require approvals (1)
  - Require status checks to pass (CI, lint)
  - Require up-to-date branches
  - Do not allow bypass

### Task 0.7: Clean up git-tracked stale + dangerous files

**Files to verify:**
- `.aider.chat.history.md` — tracked despite `.aider*` in `.gitignore` (needs `git rm --cached`)
- `session-sentinel-phase1-build.md` — contains raw GitHub tokens in AI chat transcripts
- `14.07.2026CurrentStateofRepo.md` — now superseded by the new audit

- [ ] **Step 1:** Remove `.aider.chat.history.md` from tracking

```bash
git rm --cached .aider.chat.history.md
```

- [ ] **Step 2:** Verify `session-sentinel-phase1-build.md` is gitignored. If tracked, remove from tracking and purge from git history with `git filter-branch` or `git filter-repo` (it contains secret tokens).

- [ ] **Step 3:** Remove `14.07.2026CurrentStateofRepo.md` from tracking (already in `.gitignore`, but may be tracked)

---

## Phase 1: Incremental TypeScript Migration

**Goal:** Convert backend from plain JS to TypeScript, one module cluster at a time. Each wave is a deployable PR. No big bang.

### Task 1.0: TypeScript build tooling

**Files:**
- Create: `backend/tsconfig.json`
- Modify: `backend/package.json` (add scripts, devDependencies)
- Create: `backend/src/types.ts` (shared types)

- [ ] **Step 1:** Install TypeScript tooling

```bash
cd backend && npm install --save-dev typescript @types/node @types/express @types/pg
npm install tsx --save-dev  # for dev running
```

- [ ] **Step 2:** Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3:** Add scripts to `package.json`

```json
"scripts": {
  "start": "node dist/index.js",
  "dev": "tsx watch src/index.ts",
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "test": "jest --runInBand --forceExit",
  "lint": "eslint src/ --ext .ts,.js",
  "format": "prettier --write src/"
}
```

- [ ] **Step 4:** Create `src/types.ts` with shared types used across all modules

```typescript
// Global type definitions for Project Sentinel

export type RepoStatus = 'active' | 'paused' | 'archived';
export type AgentStatus = 'idle' | 'working' | 'error' | 'unconfigured';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
export type SprintStatus = 'proposed' | 'approved' | 'in_progress' | 'completed' | 'paused';
export type BuilderType = 'aider' | 'claude-code';

export interface RepoIdentity {
  name: string;           // short name (e.g., "tapcash")
  fullName: string;       // org/repo (e.g., "thatisshayan/tapcash")
  org: string;
}

export interface AuditTask {
  id: number;
  repoName: string;
  taskTitle: string;
  priority: number;
  status: TaskStatus;
  builderAgent: string | null;
  prUrl: string | null;
  createdAt: Date;
}
// ... more types as needed
```

- [ ] **Step 5:** Set up CI to run `typecheck` after migration is complete

### Task 1.1: Convert infrastructure layer (logger, dbClient, config)

**Files:**
- Rename: `backend/src/logger.js` → `backend/src/logger.ts`
- Rename: `backend/src/dbClient.js` → `backend/src/dbClient.ts`
- Create: `backend/src/config.ts` (centralize `process.env` access)

**Strategy:** Rename `.js` to `.ts`, add types, keep the same exports. All other `.js` files can still `require()` the `.ts` files — tsx/tsc handle this.

- [ ] **Step 1:** Convert `logger.ts` — add pino type, export typed logger

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['token', 'secret', 'key', 'password', 'authorization'],
    censor: '[REDACTED]',
  },
});

export default logger;
```

- [ ] **Step 2:** Convert `dbClient.ts` — add Pool type, typed query return, typed schema init

```typescript
import { Pool, QueryResult, QueryResultRow } from 'pg';
import logger from './logger';

let pool: Pool | null = null;

interface PoolConfig {
  connectionString: string;
  ssl: { rejectUnauthorized: boolean } | boolean;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

function getPool(): Pool | null {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({ /* ... */ } as PoolConfig);
    pool.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'PostgreSQL pool error');
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = any>(
  text: string, params?: any[]
): Promise<QueryResult<T>> {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not configured');
  const start = Date.now();
  try {
    const result = await p.query<T>(text, params);
    logger.debug({ duration: Date.now() - start, rows: result.rowCount }, 'DB query');
    return result;
  } catch (err) {
    logger.error({ err: (err as Error).message, query: text }, 'DB query failed');
    throw err;
  }
}
```

- [ ] **Step 3:** Create `config.ts` — typed accessor for every `process.env` variable

```typescript
// Centralized environment variable access with validation

function env(key: string, required = true): string {
  const value = process.env[key];
  if (!value && required) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value || '';
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: () => env('DATABASE_URL'),
  redisUrl: () => env('REDIS_URL'),
  githubToken: () => env('GITHUB_TOKEN'),
  githubWebhookSecret: () => env('GITHUB_WEBHOOK_SECRET'),
  sentinelUiKey: () => env('SENTINEL_UI_KEY', false),
  notionApiKey: () => env('NOTION_API_KEY', false),
  telegramBotToken: () => env('TELEGRAM_BOT_TOKEN', false),
  telegramChatId: () => env('TELEGRAM_CHAT_ID', false),
  nvidiaApiKey: () => env('NVIDIA_API_KEY', false),
  geminiApiKey: () => env('GEMINI_API_KEY', false),
  deepseekApiKey: () => env('DEEPSEEK_API_KEY', false),
  dashscopeApiKey: () => env('DASHSCOPE_API_KEY', false),
  sentryDsn: () => env('SENTRY_DSN', false),
  logLevel: process.env.LOG_LEVEL || 'info',
  // ... add all env vars used across the codebase
};
```

### Task 1.2-1.10: Remaining TypeScript waves

Each wave follows the same pattern:
1. Rename `.js` to `.ts`
2. Add type annotations
3. Fix any type errors
4. Run `tsc --noEmit` to verify
5. Run existing tests to confirm no regressions
6. Commit with message: `feat(ts): convert <module-cluster> to TypeScript`

| Wave | Files | Dependencies |
|------|-------|-------------|
| 1.2 | All 7 `*Db.js` files | Needs Task 1.0-1.1 (types, dbClient) |
| 1.3 | Security cluster (5 files) | Needs Task 1.2 (DB types) |
| 1.4 | Agent cluster (8 files) | Independent of 1.3 |
| 1.5 | Telegram cluster (4 files) | Needs 1.1 (logger, config) |
| 1.6 | Orchestration cluster (4 files) | Needs 1.2-1.5 (DB, security, agents, telegram) |
| 1.7 | Runner cluster (4 files) | Independent |
| 1.8 | God modules (workers, webhook, api — 5 files) | Needs everything above |
| 1.9 | Commands (4 files) | Needs 1.8 |
| 1.10 | Entry point (index.js) | Needs everything |

---

## Phase 2: Error Architecture

**Goal:** Replace ad-hoc error handling with a proper taxonomy, Sentry integration, and structured logging.

### Task 2.1: Define error classes

**File:** `backend/src/errors.ts`

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class DbError extends AppError {
  constructor(message: string, code = 'DB_ERROR') {
    super(message, code, 503);
  }
}

export class AICallError extends AppError {
  constructor(message: string, public provider: string) {
    super(message, `AI_${provider.toUpperCase()}_ERROR`, 502);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class WebhookError extends AppError {
  constructor(message: string, code = 'WEBHOOK_ERROR') {
    super(message, code, 401);
  }
}

export class ConfigError extends AppError {
  constructor(key: string) {
    super(`Missing required config: ${key}`, 'CONFIG_ERROR', 500, false);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(`${entity} not found`, 'NOT_FOUND', 404);
  }
}
```

### Task 2.2: Fix global error handlers

**File:** `backend/src/index.ts`

- [ ] **Step 1:** Fix `unhandledRejection` handler — log full stack, forward to Sentry, crash on non-operational errors

```typescript
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err: err.stack || err.message }, 'Unhandled promise rejection');
  Sentry.captureException(err, { level: 'error', tags: { type: 'unhandled_rejection' } });
  // Non-operational errors should crash the process
  if (err instanceof AppError && !err.isOperational) {
    process.exit(1);
  }
});
```

- [ ] **Step 2:** Fix Express global error handler — serialize full error, distinguish operational vs programmer errors

```typescript
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn({ err: err.stack, path: req.path, code: err.code }, 'Operational error');
    Sentry.captureException(err, { level: 'warning' });
    res.status(err.httpStatus).json({
      error: err.message,
      code: err.code,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  } else {
    logger.error({ err: err.stack, path: req.path }, 'Unexpected error');
    Sentry.captureException(err, { level: 'error' });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Task 2.3: Fix all incorrect logger.error patterns

Search for `logger.error({ err: err.message })` across all files and replace with proper error serialization.

- [ ] **Step 1:** Grep for the pattern across the codebase

```bash
rg "logger\.error\(\{ err: err\.message" backend/src/
```

- [ ] **Step 2:** Replace each occurrence with `logger.error({ err }, context)` — pino serializes Error objects properly when passed as `err` property (pino has built-in Error serialization)

### Task 2.4: Add config validation on boot

**File:** `backend/src/index.ts` — fail fast with clear error if critical env vars are missing

```typescript
// After dotenv.config() and before any other initialization:
const criticalVars = ['DATABASE_URL', 'GITHUB_TOKEN', 'GITHUB_WEBHOOK_SECRET'];
const missing = criticalVars.filter(k => !process.env[k]);
if (missing.length > 0) {
  logger.fatal({ missing }, 'Missing required environment variables');
  process.exit(1);
}
```

---

## Phase 3: Security Hardening

**Goal:** Fix root-cause security issues properly, not with workarounds.

### Task 3.1: Timing-safe auth comparisons

**Files:**
- Modify: `backend/src/api.ts` (SENTINEL_UI_KEY check, line 16)
- Modify: `backend/src/index.ts` (DEBUGGER_SHARED_SECRET check, line 115)

- [ ] **Step 1:** Create `src/utils/timingSafeCompare.ts`

```typescript
import crypto from 'crypto';

export function timingSafeEqual(provided: string, expected: string): boolean {
  // Guard against timing attacks on the length comparison itself
  if (provided.length !== expected.length) {
    // Compare against self to waste same time regardless
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(provided));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
```

- [ ] **Step 2:** Replace `!==` in `api.ts`:

```typescript
// Before:
if (key && req.headers['x-sentinel-key'] !== key) {

// After:
import { timingSafeEqual } from './utils/timingSafeCompare';
if (key && !timingSafeEqual(req.headers['x-sentinel-key'] as string || '', key)) {
```

- [ ] **Step 3:** Same replacement in `index.ts` for `DEBUGGER_SHARED_SECRET`

### Task 3.2: Fix SSL certificate validation

**File:** `backend/src/dbClient.ts` (lines 10-12)

- [ ] **Step 1:** Replace `rejectUnauthorized: false` with proper CA cert handling

```typescript
ssl: process.env.NODE_ENV === 'production'
  ? process.env.DATABASE_CA_CERT
    ? { ca: process.env.DATABASE_CA_CERT, rejectUnauthorized: true }
    : { rejectUnauthorized: true }  // At minimum validate against system CAs
  : false,
```

- [ ] **Step 2:** Document in `.env.example` that Railway managed Postgres users should set `DATABASE_CA_CERT` or trust system CAs

### Task 3.3: Add rate limiting to all API routes

**File:** `backend/src/api.ts`

- [ ] **Step 1:** Apply express-rate-limit to the entire API router

```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

router.use(apiLimiter);
```

### Task 3.4: Harden UI action proxy

**File:** `ui/app/api/action/route.ts`

- [ ] **Step 1:** Replace path prefix check with an explicit whitelist of allowed paths

```typescript
const ALLOWED_PATHS = new Set([
  '/api/portfolio',
  '/api/agents',
  '/api/sprint/approve',
  '/api/sprint/skip',
  '/api/system/pause',
  '/api/system/resume',
  '/api/telegram/command',
]);

export async function POST(request: NextRequest) {
  const { path, ...body } = await request.json();
  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
  }
  // ... forward
}
```

### Task 3.5: Scope environment for child processes

**Files:**
- `backend/src/aiderRunner.ts`
- `backend/src/claudeCodeRunner.ts`
- `backend/src/claudeCodeAudit.ts`
- `backend/src/taskBuilder.ts`

- [ ] **Step 1:** Define explicit allowlist of env vars to pass to child processes

```typescript
const ALLOWED_CHILD_ENV = [
  'PATH', 'HOME', 'NODE_ENV',
  'GITHUB_TOKEN', 'GITHUB_ORG', 'REPO_LIST', 'AIDER_MODEL',
  'NVIDIA_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY', 'DEEPSEEK_API_KEY',
];
```

- [ ] **Step 2:** Replace `env: { ...process.env, ... }` with filtered env

```typescript
const childEnv: Record<string, string | undefined> = {};
for (const key of ALLOWED_CHILD_ENV) {
  if (process.env[key]) childEnv[key] = process.env[key];
}
// ... then use env: { ...childEnv, SENTRY_DSN: undefined, ...additional }
```

### Task 3.6: Add CSRF/origin check to UI proxy routes

**Files:** All 5 proxy routes in `ui/app/api/*/route.ts`

- [ ] **Step 1:** Add origin validation middleware/helper

```typescript
function isValidOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // In production, only allow the app's own origin
  if (process.env.NODE_ENV === 'production') {
    return origin === `https://${host}` || origin === process.env.APP_URL;
  }
  return true; // dev: allow all
}
```

---

## Phase 4: Test Coverage Blitz

**Goal:** Achieve 50%+ line coverage across all backend modules. Hybrid approach: unit tests with mocks for complex logic, integration tests with testcontainers for DB/queue layers.

### Task 4.0: Test infrastructure setup

**Files:**
- Modify: `backend/package.json` (add testcontainers, ts-jest, test helpers)
- Create: `backend/jest.config.ts`
- Create: `backend/test/helpers/setup.ts`
- Create: `backend/test/helpers/dbContainer.ts`
- Create: `backend/test/helpers/redisContainer.ts`

- [ ] **Step 1:** Install test tooling

```bash
cd backend && npm install --save-dev ts-jest @types/jest testcontainers @testcontainers/postgresql @testcontainers/redis
```

- [ ] **Step 2:** Create `jest.config.ts`

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts', '**/test/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.ts', 'src/**/*.js'],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 40,
      lines: 50,
      statements: 40,
    },
  },
  setupFilesAfterSetup: ['./test/helpers/setup.ts'],
};

export default config;
```

- [ ] **Step 3:** Create test container helpers

```typescript
// test/helpers/dbContainer.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

let container: any;
let client: Client;

export async function startDbContainer() {
  container = await new PostgreSqlContainer().start();
  client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  process.env.DATABASE_URL = container.getConnectionUri();
  return { client, container };
}

export async function stopDbContainer() {
  await client?.end();
  await container?.stop();
}
```

### Task 4.1: Write tests for infrastructure layer

- [ ] **Step 1:** Test `dbClient.ts` — integration test with real Postgres via testcontainers
- [ ] **Step 2:** Test `queueClient.ts` — integration test with real Redis via testcontainers
- [ ] **Step 3:** Test `logger.ts` — unit test redaction, level filtering
- [ ] **Step 4:** Test `config.ts` — unit test env var validation

### Task 4.2: Write tests for security cluster

- [ ] **Step 1:** `securityScanner.ts` — happy path (scan triggered, findings parsed), error path (API down, malformed response)
- [ ] **Step 2:** `securityPatcher.ts` — patch applied, patch fails, rollback scenario
- [ ] **Step 3:** `owaspChecker.ts` — checklist evaluation, scoring, edge cases
- [ ] **Step 4:** `secretScanner.ts` — pattern matching, false positives
- [ ] **Step 5:** `dependencyScanner.ts` — mock npm audit output parsing

### Task 4.3: Write tests for core pipeline

- [ ] **Step 1:** `workers.ts` — test each of the 25+ job handlers in isolation
- [ ] **Step 2:** `sprintOrchestrator.ts` — full lifecycle: propose → approve → execute → complete, plus edge cases (pause, skip, timeout)
- [ ] **Step 3:** `sprintPlanner.ts` — AI response parsing, malformed JSON handling, fallback
- [ ] **Step 4:** `taskBuilder.ts` — build loop with mocked child processes, fallback chain, timeout
- [ ] **Step 5:** `webhook.ts` — full HTTP integration test: valid/invalid signatures, duplicate delivery, Notion errors, PR lifecycle

### Task 4.4: Write tests for all remaining untested modules

- [ ] Agent cluster tests (agentRegistry, agentRoom, agentBots, agentReplies, agentPersonality, agentLeaderboard, agentStandup)
- [ ] Telegram cluster tests (telegramClient, telegramCommands, telegramMenus, telegramAI)
- [ ] Orchestration tests (auditOrchestrator, debugOrchestrator, parallelExecutor)
- [ ] Runner tests (aiderRunner, claudeCodeRunner, claudeCodeAudit, builderRouter)
- [ ] Command tests (repoOps, reports, agents, sprint)
- [ ] All other untested modules (29 files — at minimum one happy-path + one error-path each)

### Task 4.5: Add regression tests for 12 already-fixed bugs

- [ ] **Step 1:** Review git log for the 12 `fix(critical)`/`fix(high)` commits and extract the bug scenarios
- [ ] **Step 2:** Write a regression test for each that asserts the correct behavior

### Task 4.6: Set up UI test infrastructure

- [ ] **Step 1:** Install Vitest + React Testing Library in `ui/`

```bash
cd ui && npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2:** Add test script to `ui/package.json`

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3:** Write first UI test for `logo-mark.tsx` (simplest component) to prove the infra works
- [ ] **Step 4:** Add UI test job to CI

---

## Phase 5: Catch Pattern Elimination

**Goal:** Replace all 37 `.catch(() => {})` patterns with proper error handling. Every suppressed error gets logged, Sentry-captured, and optionally retried.

### Task 5.1: Create fire-and-forget helper

**File:** `backend/src/utils/safeFire.ts`

```typescript
import logger from '../logger';
import * as Sentry from '@sentry/node';

/**
 * Execute a fire-and-forget async operation with proper error logging.
 * Use for non-critical operations where failure should not crash the main flow,
 * but should be visible in logs and Sentry.
 */
export function safeFire<T>(
  promise: Promise<T>,
  context: string
): void {
  promise.catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error.stack, context }, 'Fire-and-forget operation failed');
    Sentry.captureException(error, {
      level: 'warning',
      tags: { operation: context, pattern: 'fire-and-forget' },
    });
  });
}
```

### Task 5.2: Replace all 37 `.catch(() => {})` patterns

**Pattern:** For each file that uses `.catch(() => {})`, replace with `safeFire()`.

| File | Line | Operation | After |
|------|------|-----------|-------|
| `agentReplies.js` | 63 | Reply check | `safeFire(promise, 'agentReplies.check')` |
| `agentRoom.js` | 85 | Room update | `safeFire(promise, 'agentRoom.update')` |
| `api.js` | 200 | Log agent message | `safeFire(promise, 'api.logAgentMessage')` |
| `auditOrchestrator.js` | 72 | Audit heartbeat | `safeFire(promise, 'auditOrchestrator.heartbeat')` |
| `webhook.js` | 142 | Telegram send | `safeFire(promise, 'webhook.sendTelegram')` |
| `workers.js` | 77 | Dashboard update | `safeFire(promise, 'workers.updateDashboard')` |
| ... | ... | ... | ... |

- [ ] **Step 1:** Grep all occurrences
- [ ] **Step 2:** Replace each one with `safeFire()` with descriptive context string
- [ ] **Step 3:** Verify each is genuinely a fire-and-forget scenario (not an accidentally suppressed critical error)

### Task 5.3: Add dead-letter queue for retryable fire-and-forget ops

**File:** `backend/src/queueClient.ts` — create a dead-letter queue pattern for operations that should retry (Notion updates, cross-repo notifications)

```typescript
export async function enqueueWithRetry(
  jobName: string,
  payload: unknown,
  options?: { maxRetries?: number; backoffMs?: number }
): Promise<void> {
  const queue = getQueue('dead-letter');
  await queue.add(jobName, payload, {
    attempts: options?.maxRetries ?? 3,
    backoff: { type: 'exponential', delay: options?.backoffMs ?? 1000 },
    removeOnComplete: true,
    removeOnFail: false, // Keep failed jobs for visibility
  });
}
```

---

## Phase 6: Architecture Refactoring

**Goal:** Break down god modules, eliminate duplication, clean up dependency patterns. Safe because Phase 4 tests catch regressions.

### Task 6.1: Split `workers.ts` (593 LOC, 25+ job types)

**Files:**
- Create: `backend/src/jobs/buildPoller.ts`
- Create: `backend/src/jobs/dailyReport.ts`
- Create: `backend/src/jobs/sprintProposal.ts`
- Create: `backend/src/jobs/agentCleanup.ts`
- Create: `backend/src/jobs/selfAudit.ts`
- Create: `backend/src/jobs/securityScan.ts`
- Create: `backend/src/jobs/repoDiscovery.ts`
- Create: `backend/src/jobs/sentinelBrain.ts`
- Modify: `backend/src/workers.ts` (delegate to job files)

**Pattern:** Each job file exports a handler function. `workers.ts` imports them all and registers them with BullMQ.

```typescript
// Example: backend/src/jobs/buildPoller.ts
import { Job } from 'bullmq';
import { enqueueBuildCheck } from '../queueClient';

export async function handleBuildPoll(job: Job): Promise<void> {
  // ... moved from workers.ts
}
```

### Task 6.2: Split `webhook.ts`

**Files:**
- Create: `backend/src/webhooks/notionSync.ts`
- Create: `backend/src/webhooks/telegramNotify.ts`
- Create: `backend/src/webhooks/securityTrigger.ts`
- Create: `backend/src/webhooks/crossRepoNotify.ts`
- Modify: `backend/src/webhook.ts` (orchestrate, delegate)

### Task 6.3: Centralize 4 duplicated AI provider call patterns

**Files:** Currently duplicated in `telegramAI.ts`, `sprintPlanner.ts`, `sentinelBrain.ts`, `ceoReport.js`
**Create:** `backend/src/ai/client.ts`

```typescript
interface AICallOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature?: number;
  timeout?: number;
  provider?: 'nvidia' | 'gemini' | 'deepseek' | 'dashscope';
}

interface AICallResult {
  content: string;
  provider: string;
  model: string;
  durationMs: number;
  cost: number;
  cached: boolean;
}

export async function callAI(options: AICallOptions): Promise<AICallResult> {
  // Unified provider selection, fallback chain, retry logic, cost tracking
}
```

Then update all 4 callers to use `callAI()`.

### Task 6.4: Eliminate inline require() calls

- [ ] **Step 1:** Grep for `require(` inside function bodies across all `.ts`/`.js` files
- [ ] **Step 2:** For each one, determine if it's genuinely needed to break a circular dependency or if it can be a top-level import
- [ ] **Step 3:** For genuine circular deps, split the shared dependency into a separate module
- [ ] **Step 4:** Move all remaining inline requires to top-level imports

### Task 6.5: Consolidate duplicated UI utilities

**Files:** `relativeTime`, `agentColor`, `mapBuild`, `mapPriority`, `healthColor`/`scoreColor` are each defined in 2-4 files

- [ ] **Step 1:** Create `ui/lib/utils.ts` with all shared utility functions
- [ ] **Step 2:** Update all imports across UI components to use the single source

---

## Phase 7: Operational Excellence

**Goal:** Turn a working app into a manageable, observable, deployable system.

### Task 7.1: DB migration tooling

**Files:**
- Create: `backend/migrations/` directory
- Create: `backend/migrations/001-initial-schema.sql`
- Create: `backend/migrate.js` (simple migration runner)
- Modify: `backend/package.json` (add `migrate` script)

**Pattern:** Replace all `CREATE TABLE IF NOT EXISTS` in `*Db.js` files with a proper migration system. Each migration is a SQL file with an up and optional down.

```sql
-- migrations/001-initial-schema.sql
-- Up
CREATE TABLE IF NOT EXISTS debug_attempts ( ... );
CREATE TABLE IF NOT EXISTS build_poll_jobs ( ... );
-- ... all tables

-- Down
DROP TABLE IF EXISTS debug_attempts;
DROP TABLE IF EXISTS build_poll_jobs;
```

```typescript
// migrate.ts — reads migrations/ dir, tracks applied in a migrations table
```

### Task 7.2: UI hardening

- [ ] **Step 1:** Add `output: "standalone"` to `next.config.mjs`

```js
const nextConfig = {
  output: 'standalone',
};
export default nextConfig;
```

- [ ] **Step 2:** Fix UI Dockerfile — multi-stage build, non-root user

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
USER node
EXPOSE 3000
ENV NODE_OPTIONS="--max-old-space-size=256"
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s CMD node -e "..."
CMD ["node", "server.js"]
```

- [ ] **Step 3:** Move `shadcn` from `dependencies` to `devDependencies` in `ui/package.json`
- [ ] **Step 4:** Add `error.tsx`, `loading.tsx`, `not-found.tsx` to all route segments in `ui/app/`
- [ ] **Step 5:** Replace mock data fallback with proper error banners in server pages

### Task 7.3: Monitoring setup

- [ ] **Step 1:** Add `/metrics` endpoint (Prometheus format or JSON) exposing:
  - Queue depth per queue
  - Active agent count
  - Webhook throughput (last hour)
  - DB pool size/usage
  - Health check status per integration
- [ ] **Step 2:** Add DB query slow-query alerting (threshold: 500ms)
- [ ] **Step 3:** Set up automated weekly self-review (confirm Sentinel audits itself)

### Task 7.4: Documentation consolidation

- [ ] **Step 1:** Archive to `docs/archive/`:
  - `PHASE2_VERIFICATION_STATUS.md`
  - `PHASE2_SESSION_SUMMARY.md`
  - `PROJECT_SENTINEL_PIPEDREAM_HANDOFF.md`
  - `PROJECT_SENTINEL_CLOSED_LOOP_MASTER_HANDOFF.md`
  - `RAILWAY_SETUP.md` (merge useful info into README first)
  - `session-sentinel-phase1-build.md` (after confirming no secrets remain)
- [ ] **Step 2:** Merge `MANUAL.md` into `README.md` (add a table of contents so it's navigable)
- [ ] **Step 3:** Fix README.md agent roster to match AGENTS.md (Nemotron 70B → Llama 3.1-70B)
- [ ] **Step 4:** Add ADR directory at `docs/adr/` with the first ADR: "Architecture for the Rebuild"

### Task 7.5: Set up Dependabot

- [ ] **Step 1:** Create `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/backend'
    schedule:
      interval: 'weekly'
    open-pull-requests-limit: 10
  - package-ecosystem: 'npm'
    directory: '/ui'
    schedule:
      interval: 'weekly'
    open-pull-requests-limit: 10
  - package-ecosystem: 'docker'
    directory: '/backend'
    schedule:
      interval: 'monthly'
  - package-ecosystem: 'docker'
    directory: '/ui'
    schedule:
      interval: 'monthly'
```

### Task 7.6: Accessibility improvements (UI)

- [ ] **Step 1:** Add `aria-label` to all icon-only buttons (sidebar actions, audit buttons, close buttons)
- [ ] **Step 2:** Add `role="navigation"` to sidebar, `role="list"` to repo list, `role="table"` to security issues table
- [ ] **Step 3:** Fix color contrast on low-contrast text (`text-s-dim` on dark backgrounds)
- [ ] **Step 4:** Add form labels to Settings page inputs
- [ ] **Step 5:** Add keyboard navigation support for dropdowns and menus

### Task 7.7: Backend Dockerfile hardening

- [ ] **Step 1:** Convert to multi-stage build
- [ ] **Step 2:** Pin base image to digest: `node:20-alpine@sha256:...`
- [ ] **Step 3:** Remove build tooling (python, pip, git, claude-code, aider) from runtime stage after install
- [ ] **Step 4:** Add `.dockerignore` to exclude `node_modules`, `.git`, `test/`, `*.md`

### Task 7.8: Railway config consistency

- [ ] **Step 1:** Normalize `ui/railway.toml` to use Dockerfile (not Nixpacks) for consistency with backend
- [ ] **Step 2:** Add `healthcheckPath = "/health"` to `ui/railway.toml`
- [ ] **Step 3:** Normalize casing (`ON_FAILURE` → `on_failure`)

### Task 7.9: Fix TODO.md P0 items (operational)

The TODO.md has 3 open P0 items about health scores stuck at defaults, zero build history, and zero tasks completed. These are operational / data-flow bugs, not code bugs:

- [ ] **Step 1:** Verify GitHub webhook is registered and pointing to correct URL
- [ ] **Step 2:** Verify `repo_metrics` table is written on each webhook event
- [ ] **Step 3:** Verify `enqueueBuildCheck` is called on push events
- [ ] **Step 4:** Manually trigger one task via Telegram and verify the full flow end to end

---

## Rollback Plan

Each task PR should be small enough that rollback means reverting the PR. For risky changes (execSync, TypeScript conversion of a core module):

1. **Before risky PR:** Run `npm run typecheck && npm test && npm run lint` on `main`
2. **After PR merge:** Monitor CI for next 2 runs. If CI fails, revert within 5 minutes.
3. **TypeScript conversions:** Keep the original `.js` file alongside the `.ts` during the first pass. Delete `.js` only after the `.ts` version has been running in production for 24+ hours.

---

## Verification Checklist

Before marking any phase complete:

- [ ] CI passes on a PR branch (not just main)
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes with full coverage threshold met
- [ ] `npm run lint` passes with zero errors
- [ ] No new `.catch(() => {})` patterns introduced
- [ ] No new `any` types introduced (TypeScript strict mode)
- [ ] Docker builds locally (`docker build -t sentinel .`)
- [ ] Phase added to `STATUS.md` as completed

---

*Plan saved 2026-07-16. Based on audit in `2026-07-16-DeepCodebaseAudit.md`.*
