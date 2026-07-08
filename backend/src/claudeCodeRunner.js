const { spawn } = require('child_process');
const logger    = require('./logger');

const BUILD_TIMEOUT_MS = () =>
  parseInt(process.env.DEBUG_TIMEOUT_MINUTES || process.env.AIDER_TIMEOUT_MINUTES || '30') * 60 * 1000;
const BUILD_MODEL = process.env.BUILD_MODEL || 'claude-sonnet-4-6';

function buildTaskPrompt(task, context) {
  const { projectName, repoName } = context;

  return `You are an autonomous code improvement agent on the ${projectName || repoName} repo.

TASK ${task.task_number}/10:
Title: ${task.title}
Priority: ${task.priority}
Category: ${task.category}

Description:
${task.description}

Files likely involved:
${(task.affected_files || []).join('\n') || 'Determine from description'}

Acceptance Criteria:
${task.acceptance_criteria || 'Task description is fully satisfied'}

RULES — follow every one exactly:
1. Use Read tool to read affected files first. Understand current state fully.
2. Make only changes needed to satisfy acceptance criteria.
3. Do not refactor or touch files unrelated to this task.
4. Never change: .env files, auth logic, payments, migrations,
   Dockerfile, CI config, .github/, railway.toml, vercel.json.
5. Keep changes minimal. Do not over-engineer.
6. After making changes, use Bash to commit with this EXACT message:
   feat(sentinel): ${task.title} — Task ${task.task_number}/10
7. If you cannot complete safely, run git checkout -- . and make NO commit.
8. One clean commit only. Do NOT push. The backend handles push.
9. Do NOT run npm install, npm test, npm run build, or any package manager commands.

Conservative and precise. This is a live production codebase.`;
}

async function runClaudeCodeForTask(repoPath, task, context) {
  const prompt = buildTaskPrompt(task, context);

  return new Promise((resolve) => {
    const args = [
      '--print',
      '--allowedTools', 'Edit,Write,Read,Bash',
      ...(BUILD_MODEL.startsWith('claude') ? ['--model', BUILD_MODEL] : []),
      '-p', prompt,
    ];

    logger.info({ taskNumber: task.task_number, title: task.title },
      'Claude Code task execution starting');

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
      resolve({ success: false, reason: `Timed out on task ${task.task_number}` });
    }, BUILD_TIMEOUT_MS());

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success:  code === 0,
        exitCode: code,
        stdout:   stdout.slice(-5000),
        stderr:   stderr.slice(-1000),
        reason:   code === 0 ? null : `Claude Code exited with code ${code}`,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, reason: `spawn failed: ${err.message}` });
    });
  });
}

module.exports = { runClaudeCodeForTask };
