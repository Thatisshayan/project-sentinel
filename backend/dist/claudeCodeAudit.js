"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const child_process_1 = require("child_process");
const axios_1 = __importDefault(require("axios"));
const simple_git_1 = __importDefault(require("simple-git"));
const tmp_1 = __importDefault(require("tmp"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("./logger"));
const aiOutputValidator_1 = require("./aiOutputValidator");
const childEnv_1 = require("./utils/childEnv");
const AUDIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const AUDIT_MODEL = process.env['AUDIT_MODEL'] || 'mistralai/mistral-nemotron';
const CONTEXT_FILE_BUDGET = 30;
const CONTEXT_CHAR_BUDGET = 20000;
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
function buildRepoContext(repoPath) {
    const sections = [];
    let charsUsed = 0;
    function addSection(label, content) {
        if (!content || charsUsed >= CONTEXT_CHAR_BUDGET)
            return;
        const trimmed = content.slice(0, 2000);
        sections.push(`--- ${label} ---\n${trimmed}`);
        charsUsed += trimmed.length;
    }
    function readSafe(relPath) {
        try {
            return fs_1.default.readFileSync(path_1.default.join(repoPath, relPath), 'utf8');
        }
        catch {
            return null;
        }
    }
    // Root-level manifests
    addSection('package.json', readSafe('package.json'));
    addSection('README.md', readSafe('README.md') || readSafe('readme.md'));
    // Nested package.json files (monorepo workspaces) — skip if same as root
    for (const sub of ['backend', 'frontend', 'ui', 'server', 'api']) {
        const content = readSafe(`${sub}/package.json`);
        if (content)
            addSection(`${sub}/package.json`, content);
    }
    // Entry files — check both root and common monorepo subdirs
    const entryPaths = [
        'index.js', 'app.js', 'server.js',
        'backend/src/index.js', 'backend/index.js',
        'frontend/src/index.js', 'ui/src/index.js',
    ];
    for (const ep of entryPaths) {
        if (fs_1.default.existsSync(path_1.default.join(repoPath, ep))) {
            addSection(ep, readSafe(ep));
            break;
        }
    }
    const files = [];
    function walk(dir) {
        if (files.length >= CONTEXT_FILE_BUDGET)
            return;
        let entries;
        try {
            entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= CONTEXT_FILE_BUDGET)
                return;
            if (SKIP_DIRS.has(entry.name))
                continue;
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (/\.(js|ts|jsx|tsx)$/.test(entry.name)) {
                files.push(full);
            }
        }
    }
    for (const dir of SOURCE_DIRS) {
        const abs = path_1.default.join(repoPath, dir);
        if (fs_1.default.existsSync(abs))
            walk(abs);
    }
    for (const file of files) {
        if (charsUsed >= CONTEXT_CHAR_BUDGET)
            break;
        const rel = path_1.default.relative(repoPath, file);
        addSection(rel, readSafe(rel));
    }
    return sections.join('\n\n');
}
function buildAuditPrompt(payload, repoContext) {
    const { repoFullName, repoName, projectName, commitSha } = payload;
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
    return `You are a senior software engineer conducting a full codebase audit for Project Sentinel.

REPO: ${repoFullName}
PROJECT: ${projectName || repoName}
COMMIT: ${commitSha}
${repoContext ? `\nREPOSITORY SNAPSHOT:\n${repoContext}\n` : ''}
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
async function runClaudeCodeAudit(repoPath, payload) {
    const prompt = buildAuditPrompt(payload);
    return new Promise((resolve) => {
        const args = [
            '--print',
            '--allowedTools', 'Read,Bash',
            ...(AUDIT_MODEL.startsWith('claude') ? ['--model', AUDIT_MODEL] : []),
            '-p', prompt,
        ];
        logger_1.default.info({ repo: payload.repoFullName }, 'Claude Code audit starting');
        let stdout = '';
        let stderr = '';
        const proc = (0, child_process_1.spawn)('claude', args, {
            cwd: repoPath,
            env: (0, childEnv_1.buildChildEnv)({ ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] }),
        });
        proc.stdout.on('data', (c) => { stdout += c.toString(); });
        proc.stderr.on('data', (c) => { stderr += c.toString(); });
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            logger_1.default.warn({ repo: payload.repoFullName }, 'Claude Code audit timed out');
            resolve({ success: false, reason: 'Audit timed out after 10 minutes', stdout });
        }, AUDIT_TIMEOUT_MS);
        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                success: code === 0,
                exitCode: code,
                stdout,
                stderr: stderr.slice(-1000),
                reason: code === 0 ? null : `Claude Code exited with code ${code}`,
            });
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({ success: false, reason: `spawn failed: ${err.message}` });
        });
    });
}
// NVIDIA NIM fallback — used when ANTHROPIC_API_KEY is absent but NVIDIA_API_KEY is set.
// Sends the same audit prompt directly to the NVIDIA NIM chat completions endpoint.
// Unlike the Claude Code CLI path, this model has no Read tool, so repoContext
// (built from a real clone of the repo) is embedded directly in the prompt.
async function runNvidiaAudit(payload, repoContext) {
    const prompt = buildAuditPrompt(payload, repoContext);
    logger_1.default.info({ repo: payload.repoFullName, model: AUDIT_MODEL }, 'NVIDIA NIM audit starting');
    const response = await axios_1.default.post('https://integrate.api.nvidia.com/v1/chat/completions', {
        model: AUDIT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.1,
    }, {
        headers: {
            Authorization: `Bearer ${process.env['NVIDIA_API_KEY']}`,
            'Content-Type': 'application/json',
        },
        timeout: AUDIT_TIMEOUT_MS,
    });
    const text = response.data.choices[0]?.message?.content || '';
    return parseAuditOutput(text);
}
function parseAuditOutput(stdout) {
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
    let parsed;
    try {
        parsed = JSON.parse(jsonMatch[0]);
    }
    catch (err) {
        throw new Error(`Failed to parse audit JSON: ${err.message} — raw tail: ${stripped.slice(-200)}`);
    }
    (0, aiOutputValidator_1.validateAuditOutput)(parsed);
    parsed.tasks = parsed.tasks.slice(0, 10).map((t, i) => ({
        taskNumber: t.taskNumber || i + 1,
        priority: t.priority || 'medium',
        category: t.category || 'code-quality',
        title: (t.title || `Task ${i + 1}`).substring(0, 80),
        description: t.description || '',
        affectedFiles: Array.isArray(t.affectedFiles) ? t.affectedFiles : [],
        estimatedComplexity: t.estimatedComplexity || 'medium',
        safeToAutoExecute: t.safeToAutoExecute === true,
        safetyReason: t.safetyReason || '',
        acceptanceCriteria: t.acceptanceCriteria || '',
    }));
    return parsed;
}
async function runAudit(payload) {
    const { repoFullName } = payload;
    const tmpDir = tmp_1.default.dirSync({ unsafeCleanup: true, prefix: 'sentinel-audit-' });
    try {
        logger_1.default.info({ repoFullName }, 'Cloning repo for audit');
        const cloneUrl = `https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`;
        await (0, simple_git_1.default)().clone(cloneUrl, tmpDir.name, [
            '--depth', '1',
            '--branch', payload.branchName || 'main',
        ]);
        // NVIDIA NIM is the primary audit path — no ANTHROPIC_API_KEY required.
        // It has no Read tool, so it gets a text snapshot of the cloned repo instead.
        if (process.env['NVIDIA_API_KEY']) {
            const auditResult = await runNvidiaAudit(payload, buildRepoContext(tmpDir.name));
            logger_1.default.info({
                repoFullName,
                tasks: auditResult.tasks.length,
                score: auditResult.overallHealthScore,
                safe: auditResult.tasks.filter((t) => t.safeToAutoExecute).length,
            }, 'Audit complete');
            return auditResult;
        }
        const result = await runClaudeCodeAudit(tmpDir.name, payload);
        if (!result.success) {
            throw new Error(result.reason || 'Claude Code audit failed');
        }
        const auditResult = parseAuditOutput(result.stdout);
        logger_1.default.info({
            repoFullName,
            tasks: auditResult.tasks.length,
            score: auditResult.overallHealthScore,
            safe: auditResult.tasks.filter((t) => t.safeToAutoExecute).length,
        }, 'Audit complete');
        return auditResult;
    }
    finally {
        try {
            tmpDir.removeCallback();
        }
        catch (e) { }
    }
}
module.exports = { runAudit };
//# sourceMappingURL=claudeCodeAudit.js.map