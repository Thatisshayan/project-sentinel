import { spawn } from 'child_process';
import axios from 'axios';
import simpleGit from 'simple-git';
import tmp from 'tmp';
import fs from 'fs';
import path from 'path';
import logger from './logger';
import { validateAuditOutput } from './aiOutputValidator';
import { buildChildEnv } from './utils/childEnv';
import projectMemory from './projectMemory';

const AUDIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const AUDIT_MODEL = process.env['AUDIT_MODEL'] || 'mistralai/mistral-nemotron';

const CONTEXT_FILE_BUDGET  = 30;
const CONTEXT_CHAR_BUDGET  = 20000;
// Ordered by priority — deeper monorepo paths come before shallow ones so we
// don't fill the budget with trivial root-level stubs and miss actual code.
const SOURCE_DIRS = [
  'backend/src', 'frontend/src', 'ui/src', 'packages/api/src', 'packages/server/src',
  'src', 'lib', 'routes', 'services', 'models', 'controllers', 'app',
  'backend', 'frontend', 'server', 'api',
];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo']);

// Builds a lightweight text snapshot of the repo for AI providers that have
// no file-read tool (e.g. NVIDIA NIM chat-completions path).
// Handles both flat repos and monorepos (backend/src, ui/src, etc.).
function buildRepoContext(repoPath: string): string {
  const sections: string[] = [];
  let charsUsed  = 0;

  function addSection(label: string, content: string | null): void {
    if (!content || charsUsed >= CONTEXT_CHAR_BUDGET) return;
    const trimmed = content.slice(0, 2000);
    sections.push(`--- ${label} ---\n${trimmed}`);
    charsUsed += trimmed.length;
  }

  function readSafe(relPath: string): string | null {
    try { return fs.readFileSync(path.join(repoPath, relPath), 'utf8'); }
    catch { return null; }
  }

  // Root-level manifests
  addSection('package.json', readSafe('package.json'));
  addSection('README.md',    readSafe('README.md') || readSafe('readme.md'));

  // Nested package.json files (monorepo workspaces) — skip if same as root
  for (const sub of ['backend', 'frontend', 'ui', 'server', 'api']) {
    const content = readSafe(`${sub}/package.json`);
    if (content) addSection(`${sub}/package.json`, content);
  }

  // Entry files — check both root and common monorepo subdirs
  const entryPaths = [
    'index.js', 'app.js', 'server.js',
    'backend/src/index.js', 'backend/index.js',
    'frontend/src/index.js', 'ui/src/index.js',
  ];
  for (const ep of entryPaths) {
    if (fs.existsSync(path.join(repoPath, ep))) {
      addSection(ep, readSafe(ep));
      break;
    }
  }

  const files: string[] = [];
  function walk(dir: string): void {
    if (files.length >= CONTEXT_FILE_BUDGET) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (files.length >= CONTEXT_FILE_BUDGET) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|ts|jsx|tsx)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(repoPath, dir);
    if (fs.existsSync(abs)) walk(abs);
  }

  for (const file of files) {
    if (charsUsed >= CONTEXT_CHAR_BUDGET) break;
    const rel = path.relative(repoPath, file);
    addSection(rel, readSafe(rel));
  }

  return sections.join('\n\n');
}

interface AuditPayload {
  repoFullName: string;
  repoName?: string;
  projectName?: string;
  commitSha?: string;
  branchName?: string;
  // D-027 item 5 (multi-aspect audit + scoring + rotation) — which single
  // dimension (security, frontend, backend, ...) this audit cycle should
  // focus its 10 tasks on. See auditAspects.ts for the rotation policy that
  // decides this per repo.
  aspect?: string;
}

const ASPECT_DESCRIPTIONS: Record<string, string> = {
  security:         'authentication, authorization, secrets handling, input validation, dependency/supply-chain vulnerabilities',
  functionality:    'correctness bugs, broken features, edge cases, logic errors',
  backend:          'server-side architecture, API design, data handling, background jobs',
  frontend:         'client-side code structure, state management, rendering correctness',
  ux_accessibility: 'usability, accessibility (a11y), UI consistency, error messaging shown to users',
  performance:      'execution speed, resource usage, N+1 queries, unnecessary work, bundle size',
  observability:    'logging, monitoring, error tracking, health checks, alerting coverage',
  documentation:    'README accuracy, code comments, API/setup documentation, onboarding docs',
  testing:          'test coverage, missing tests for critical paths, flaky/broken tests',
  database:         'schema design, migrations, indexing, query efficiency, data integrity',
};

function buildAuditPrompt(payload: AuditPayload, repoContext?: string, memoryText?: string): string {
  const { repoFullName, repoName, projectName, commitSha, aspect } = payload;

  const taskInstructions = repoContext
    ? `YOUR TASK:
1. Below is a snapshot of this repository's package.json, README, and key
   source files. Use it to understand what the project does and its health.
2. Generate exactly 10 improvement tasks ranked by priority.`
    : `YOUR TASK:
1. Use your Read tool to explore this repository. Start with package.json,
   README.md, and the main entry file (index.js, app.js, or server.js).
2. Read the most important source files — routes, services, models,
   auth, middleware, database, config files.
3. Understand what this project does and its current health.
4. Generate exactly 10 improvement tasks ranked by priority.`;

  const aspectFocus = aspect
    ? `\nFOCUS: This audit cycle is dedicated to the "${aspect}" aspect of the repo — ${ASPECT_DESCRIPTIONS[aspect] || aspect}. ALL 10 tasks must be about this aspect specifically. Do not generate tasks about other aspects, even if you notice issues elsewhere — those will be covered in a future rotation.\n`
    : '';

  return `You are a senior software engineer conducting a full codebase audit for Project Sentinel.

REPO: ${repoFullName}
PROJECT: ${projectName || repoName}
COMMIT: ${commitSha}
${aspectFocus}${memoryText ? `\n${memoryText}\n` : ''}${repoContext ? `\nREPOSITORY SNAPSHOT:\n${repoContext}\n` : ''}
${taskInstructions}

CRITICAL OUTPUT RULE:
Your ENTIRE response must be valid JSON only.
No explanation. No markdown fences. No preamble. No text after the JSON.
Start with { and end with }

For safeToAutoExecute, set false if the task involves:
- Secrets, environment variables, .env files
- Database schema changes or migrations
- Authentication or authorization logic
- Payment or billing code
- File deletions or large refactors
- Dockerfile, CI config, .github/, railway.toml, vercel.json
- Anything estimated as high complexity

Output this exact structure:
{
  "repoName": "${repoName}",
  "commitHash": "${commitSha}",
  "auditTimestamp": "<current ISO 8601 timestamp>",
  "auditSummary": "<2-3 sentence plain-English summary of repo health>",
  "overallHealthScore": <integer 1 to 10>,
  "aspectHealthScore": <integer 1 to 10 — an honest score for ONLY the "${aspect || 'general'}" aspect, not the whole repo>,
  "aspectEffectSummary": "<plain-English: what recent changes to this repo mean in practice for this aspect specifically — not a description of the code, but the real-world effect (e.g. 'a missing rate limit on login means an attacker could brute-force passwords' rather than 'the login route has no middleware'). If nothing recent is aspect-relevant, describe the current real-world exposure/risk instead.>",
  "tasks": [
    {
      "taskNumber": 1,
      "priority": "critical",
      "category": "security",
      "title": "<short title under 80 characters>",
      "description": "<full description of what to do and why>",
      "affectedFiles": ["path/to/actual/file.js"],
      "estimatedComplexity": "low",
      "safeToAutoExecute": true,
      "safetyReason": "<why it is or is not safe>",
      "acceptanceCriteria": "<how to verify this task is complete>"
    }
  ]
}

Priority order: critical → high → medium → low
Exactly 10 tasks. No more, no less.`;
}

interface ClaudeResult {
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  reason?: string | null;
}

async function runClaudeCodeAudit(repoPath: string, payload: AuditPayload, memoryText?: string): Promise<ClaudeResult> {
  const prompt = buildAuditPrompt(payload, undefined, memoryText);

  return new Promise((resolve) => {
    const args = [
      '--print',
      '--allowedTools', 'Read,Bash',
      ...(AUDIT_MODEL.startsWith('claude') ? ['--model', AUDIT_MODEL] : []),
      '-p', prompt,
    ];

    logger.info({ repo: payload.repoFullName }, 'Claude Code audit starting');

    let stdout = '';
    let stderr = '';

    const proc = spawn('claude', args, {
      cwd: repoPath,
      env: buildChildEnv({ ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] }),
    });

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      logger.warn({ repo: payload.repoFullName }, 'Claude Code audit timed out');
      resolve({ success: false, reason: 'Audit timed out after 10 minutes', stdout });
    }, AUDIT_TIMEOUT_MS);

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr: stderr.slice(-1000),
        reason: code === 0 ? null : `Claude Code exited with code ${code}`,
      });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({ success: false, reason: `spawn failed: ${err.message}` });
    });
  });
}

// NVIDIA NIM fallback — used when ANTHROPIC_API_KEY is absent but NVIDIA_API_KEY is set.
// Sends the same audit prompt directly to the NVIDIA NIM chat completions endpoint.
// Unlike the Claude Code CLI path, this model has no Read tool, so repoContext
// (built from a real clone of the repo) is embedded directly in the prompt.
async function runNvidiaAudit(payload: AuditPayload, repoContext: string, memoryText?: string): Promise<any> {
  const prompt = buildAuditPrompt(payload, repoContext, memoryText);

  logger.info({ repo: payload.repoFullName, model: AUDIT_MODEL }, 'NVIDIA NIM audit starting');

  const response = await axios.post(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      model:       AUDIT_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  4096,
      temperature: 0.1,
    },
    {
      headers: {
        Authorization:  `Bearer ${process.env['NVIDIA_API_KEY']}`,
        'Content-Type': 'application/json',
      },
      timeout: AUDIT_TIMEOUT_MS,
    }
  );

  const text = response.data.choices[0]?.message?.content || '';
  return parseAuditOutput(text);
}

function parseAuditOutput(stdout: string): any {
  if (!stdout || stdout.trim() === '') {
    throw new Error('Claude Code returned empty audit output');
  }

  // Strip <think>...</think> blocks — reasoning models (nemotron, deepseek-reasoner)
  // emit these before JSON. The greedy /\{[\s\S]*\}/ regex can match into a think
  // block if it contains { characters, producing unparseable text.
  const stripped = stdout.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in Claude Code audit output');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    throw new Error(`Failed to parse audit JSON: ${err.message} — raw tail: ${stripped.slice(-200)}`);
  }

  validateAuditOutput(parsed);

  // Aspect fields are additive/optional (older audits or a model that
  // ignores the instruction won't include them) — default rather than
  // reject, so a missing aspect score never fails the whole audit.
  parsed.aspectHealthScore   = typeof parsed.aspectHealthScore === 'number'
    ? Math.max(1, Math.min(10, Math.round(parsed.aspectHealthScore)))
    : parsed.overallHealthScore;
  parsed.aspectEffectSummary = typeof parsed.aspectEffectSummary === 'string' && parsed.aspectEffectSummary.trim()
    ? parsed.aspectEffectSummary.trim()
    : '';

  parsed.tasks = parsed.tasks.slice(0, 10).map((t: any, i: number) => ({
    taskNumber:          t.taskNumber          || i + 1,
    priority:            t.priority            || 'medium',
    category:            t.category            || 'code-quality',
    title:               (t.title              || `Task ${i + 1}`).substring(0, 80),
    description:         t.description         || '',
    affectedFiles:       Array.isArray(t.affectedFiles) ? t.affectedFiles : [],
    estimatedComplexity: t.estimatedComplexity || 'medium',
    safeToAutoExecute:   t.safeToAutoExecute   === true,
    safetyReason:        t.safetyReason        || '',
    acceptanceCriteria:  t.acceptanceCriteria  || '',
  }));

  return parsed;
}

async function runAudit(payload: AuditPayload): Promise<any> {
  const { repoFullName } = payload;

  const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: 'sentinel-audit-' });

  try {
    logger.info({ repoFullName }, 'Cloning repo for audit');

    const cloneUrl = `https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`;
    await simpleGit().clone(cloneUrl, tmpDir.name, [
      '--depth', '1',
      '--branch', payload.branchName || 'main',
    ]);

    // D-027 item 6 (project memory) — dismissed findings/conventions/prior
    // decisions recorded for this repo, fed into the audit prompt so the
    // same false positive or violated convention doesn't get re-raised
    // every audit cycle.
    const memoryText = await projectMemory.getMemoryForPrompt(repoFullName);

    // NVIDIA NIM is the primary audit path — no ANTHROPIC_API_KEY required.
    // It has no Read tool, so it gets a text snapshot of the cloned repo instead.
    if (process.env['NVIDIA_API_KEY']) {
      const auditResult = await runNvidiaAudit(payload, buildRepoContext(tmpDir.name), memoryText);
      logger.info({
        repoFullName,
        tasks: auditResult.tasks.length,
        score: auditResult.overallHealthScore,
        safe:  auditResult.tasks.filter((t: any) => t.safeToAutoExecute).length,
      }, 'Audit complete');
      return auditResult;
    }

    const result = await runClaudeCodeAudit(tmpDir.name, payload, memoryText);

    if (!result.success) {
      throw new Error(result.reason || 'Claude Code audit failed');
    }

    const auditResult = parseAuditOutput(result.stdout!);

    logger.info({
      repoFullName,
      tasks: auditResult.tasks.length,
      score: auditResult.overallHealthScore,
      safe:  auditResult.tasks.filter((t: any) => t.safeToAutoExecute).length,
    }, 'Audit complete');

    return auditResult;

  } finally {
    try { tmpDir.removeCallback(); } catch (e: any) {
      logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e) }, 'claudeCodeAudit: tmpDir cleanup failed');
    }
  }
}

export = { runAudit, buildAuditPrompt, parseAuditOutput };
