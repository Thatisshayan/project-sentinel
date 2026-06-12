const { spawn }  = require('child_process');
const axios      = require('axios');
const simpleGit  = require('simple-git');
const tmp        = require('tmp');
const logger     = require('./logger');

const AUDIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const AUDIT_MODEL = process.env.AUDIT_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct';

function buildAuditPrompt(payload) {
  const { repoFullName, repoName, projectName, commitSha } = payload;

  return `You are a senior software engineer conducting a full codebase audit for Project Sentinel.

REPO: ${repoFullName}
PROJECT: ${projectName || repoName}
COMMIT: ${commitSha}

YOUR TASK:
1. Use your Read tool to explore this repository. Start with package.json,
   README.md, and the main entry file (index.js, app.js, or server.js).
2. Read the most important source files — routes, services, models,
   auth, middleware, database, config files.
3. Understand what this project does and its current health.
4. Generate exactly 10 improvement tasks ranked by priority.

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
      "affectedFiles": ["src/file.js"],
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

    logger.info({ repo: payload.repoFullName }, 'Claude Code audit starting');

    let stdout = '';
    let stderr = '';

    const proc = spawn('claude', args, {
      cwd: repoPath,
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
    });

    proc.stdout.on('data', c => { stdout += c.toString(); });
    proc.stderr.on('data', c => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      logger.warn({ repo: payload.repoFullName }, 'Claude Code audit timed out');
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
async function runNvidiaAudit(payload) {
  const prompt = buildAuditPrompt(payload);

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
        Authorization:  `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: AUDIT_TIMEOUT_MS,
    }
  );

  const text = response.data.choices[0]?.message?.content || '';
  return parseAuditOutput(text);
}

function parseAuditOutput(stdout) {
  if (!stdout || stdout.trim() === '') {
    throw new Error('Claude Code returned empty audit output');
  }

  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in Claude Code audit output');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`Failed to parse audit JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed.tasks)) {
    throw new Error('Audit result missing tasks array');
  }

  parsed.tasks = parsed.tasks.slice(0, 10).map((t, i) => ({
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

async function runAudit(payload) {
  const { repoFullName } = payload;

  // Fallback: if ANTHROPIC_API_KEY is absent but NVIDIA_API_KEY is set,
  // call NVIDIA NIM directly (no file access, but same structured output).
  if (!process.env.ANTHROPIC_API_KEY && process.env.NVIDIA_API_KEY) {
    return runNvidiaAudit(payload);
  }

  const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: 'sentinel-audit-' });

  try {
    logger.info({ repoFullName }, 'Cloning repo for audit');

    const cloneUrl = `https://${process.env.GITHUB_TOKEN}@github.com/${repoFullName}.git`;
    await simpleGit().clone(cloneUrl, tmpDir.name, [
      '--depth', '1',
      '--branch', payload.branchName || 'main',
    ]);

    const result = await runClaudeCodeAudit(tmpDir.name, payload);

    if (!result.success) {
      throw new Error(result.reason || 'Claude Code audit failed');
    }

    const auditResult = parseAuditOutput(result.stdout);

    logger.info({
      repoFullName,
      tasks: auditResult.tasks.length,
      score: auditResult.overallHealthScore,
      safe:  auditResult.tasks.filter(t => t.safeToAutoExecute).length,
    }, 'Audit complete');

    return auditResult;

  } finally {
    try { tmpDir.removeCallback(); } catch (e) {}
  }
}

module.exports = { runAudit };
