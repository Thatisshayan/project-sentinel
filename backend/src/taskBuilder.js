const simpleGit  = require('simple-git');
const tmp        = require('tmp');
const { spawn, execSync } = require('child_process');
const fs         = require('fs');
const path       = require('path');
const logger     = require('./logger');
const { runClaudeCodeForTask } = require('./claudeCodeRunner');
const { getBuilderConfig, getAiderEnv } = require('./builderRouter');
const { updateAuditTask }    = require('./auditDb');
const { updateNotionTaskStatus } = require('./auditTaskWriter');

const AIDER_TIMEOUT_MS = parseInt(process.env.AIDER_TIMEOUT_MINUTES || '20', 10) * 60 * 1000;

async function executeBatch(tasks, context, builderAssignment) {
  const { repoFullName, branchName, projectName, repoName, topicId } = context;
  const builderConfig = getBuilderConfig(builderAssignment);
  const batchNum      = tasks[0].batch_number;
  const batchNums     = `${tasks[0].task_number}-${tasks[tasks.length - 1].task_number}`;

  logger.info({
    repoFullName, tasks: tasks.length,
    builder: builderConfig.label, batch: batchNums,
  }, 'Starting batch execution');

  const tmpDir = tmp.dirSync({
    unsafeCleanup: true,
    prefix:        `sentinel-batch-${batchNum}-`,
  });

  try {
    const cloneUrl = `https://${process.env.GITHUB_TOKEN}@github.com/${repoFullName}.git`;
    await simpleGit().clone(cloneUrl, tmpDir.name, [
      '--depth', '1', '--branch', branchName || 'main',
    ]);

    const repoGit = simpleGit(tmpDir.name);
    await repoGit.addConfig('user.email', 'sentinel@project-sentinel.app');
    await repoGit.addConfig('user.name',  'Project Sentinel');

    // Record the current tip of the base branch before we start work
    const initialLog = await repoGit.log({ maxCount: 1 });
    const initialBaseSha = initialLog.latest?.hash || null;

    const taskBranch = `sentinel/batch-${batchNum}-tasks-${batchNums}`;
    await repoGit.checkoutLocalBranch(taskBranch);

    const completedTasks = [];
    let   lastCommitSha  = null;
    let   lastTaskStdout = '';
    let   lastTaskStderr = '';

    for (const task of tasks) {
      logger.info({ taskNumber: task.task_number, builder: builderConfig.id },
        'Executing task in batch');

      // Send heartbeat every 2 minutes so Telegram isn't silent during long runs
      const heartbeatStart = Date.now();
      const heartbeatTimer = topicId
        ? setInterval(() => {
            const elapsed = Math.round((Date.now() - heartbeatStart) / 60000);
            const { sendTelegramMessage } = require('./telegramClient');
            sendTelegramMessage(
              `Agent working on task ${task.task_number}/${tasks.length} — ${task.title}\nElapsed: ${elapsed}m | Builder: ${builderConfig.label}`,
              null, topicId
            ).catch(() => {});
          }, 2 * 60 * 1000)
        : null;

      let taskResult;

      try {
        if (builderConfig.type === 'claude_code') {
          taskResult = await runClaudeCodeForTask(tmpDir.name, task, context);
        } else if (builderConfig.type === 'aider' || builderConfig.type === 'openai_compatible') {
          // openai_compatible uses aider with OPENAI_API_BASE set in getAiderEnv
          taskResult = await runAiderForTask(tmpDir.name, task, context, builderConfig);
        } else {
          taskResult = { success: false, reason: `Unknown builder type: ${builderConfig.type}` };
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }

      lastTaskStdout = (taskResult.stdout || '').slice(-1500);
      lastTaskStderr = (taskResult.stderr || '').slice(-1500);

      if (!taskResult.success) {
        logger.warn({
          taskNumber:  task.task_number,
          reason:      taskResult.reason || `aider exit code ${taskResult.exitCode}`,
          stdoutTail:  lastTaskStdout,
          stderrTail:  lastTaskStderr,
        }, 'Task failed — stopping batch at this point');
        break;
      }

      // Detect a new commit by SHA, not by matching commit message text —
      // the AI builder doesn't reliably follow the exact "feat(sentinel): ..."
      // template, so message-matching silently discarded real commits.
      const log = await repoGit.log({ maxCount: 1 });
      const headSha = log.latest?.hash || null;
      if (headSha && headSha !== (lastCommitSha || initialBaseSha)) {
        lastCommitSha = headSha;
        completedTasks.push(task);
        logger.info({ taskNumber: task.task_number, sha: lastCommitSha.slice(0, 7) },
          'Task committed');
      } else {
        // No commit — check if files were changed but not committed (aider bug or hook failure)
        let gitStatus = '';
        try {
          const st = await repoGit.status();
          gitStatus = `modified:${st.modified.length} new:${st.created.length} staged:${(st.staged||[]).length}`;
        } catch (_) {}
        logger.warn({
          taskNumber: task.task_number,
          stdoutTail: lastTaskStdout,
          stderrTail: lastTaskStderr,
          gitStatus,
        }, 'No new commit found — task may have been skipped by the builder');
        // Log to agent_messages for UI visibility
        const { logAgentMessage } = require('./agentDb');
        await logAgentMessage(
          'sentinel', 'Sentinel',
          `Task ${task.task_number} "${task.title}" produced no commit (${gitStatus}).\nStdout:\n${(taskResult.stdout||'').slice(-600)}\nStderr:\n${(taskResult.stderr||'').slice(-200)}`,
          'error', context.repoName
        ).catch(() => {});
      }
    }

    if (completedTasks.length === 0) {
      return {
        status:  'failed',
        reason:  'No tasks in the batch produced a commit',
        taskBranch,
        lastStdout: lastTaskStdout,
        lastStderr: lastTaskStderr,
      };
    }

    // Check if base branch moved during execution — warn if so (PR may have conflicts)
    try {
      await repoGit.fetch('origin', branchName || 'main');
      const latestLog = await repoGit.log([`origin/${branchName || 'main'}`, '--max-count=1']);
      const currentBaseSha = latestLog.latest?.hash || null;
      if (initialBaseSha && currentBaseSha && initialBaseSha !== currentBaseSha) {
        logger.warn({ repoFullName, initialBaseSha, currentBaseSha }, 'Base branch moved during batch — PR may have merge conflicts');
        const { sendTelegramMessage } = require('./telegramClient');
        sendTelegramMessage(
          `Project Sentinel — Merge Conflict Risk ⚠️\n\nRepo: ${repoName}\nBase branch moved while the batch was running.\nThe PR may have conflicts — review before merging.`,
          null, topicId
        ).catch(() => {});
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'Could not check for base branch changes');
    }

    await repoGit.push('origin', taskBranch);

    logger.info({ repoFullName, taskBranch, count: completedTasks.length },
      'Batch branch pushed');

    const { query }    = require('./dbClient');
    const remaining    = await query(`
      SELECT COUNT(*) as count FROM audit_tasks
      WHERE repo_full_name=$1
        AND status='queued'
        AND safe_to_auto_execute=true
    `, [repoFullName]);

    return {
      status:         'completed',
      taskBranch,
      commitSha:      lastCommitSha,
      commitUrl:      `https://github.com/${repoFullName}/commit/${lastCommitSha}`,
      completedTasks,
      skippedCount:   tasks.length - completedTasks.length,
      remainingTasks: parseInt(remaining.rows[0]?.count || '0'),
      builderUsed:    builderConfig.label,
    };

  } catch (err) {
    logger.error({ err: err.message, repoFullName }, 'executeBatch threw an error');
    return { status: 'error', reason: err.message };
  } finally {
    try { tmpDir.removeCallback(); } catch (e) {}
  }
}

function installDependencies(repoPath) {
  try {
    if (fs.existsSync(path.join(repoPath, 'package-lock.json'))) {
      execSync('npm ci --prefer-offline --no-audit', { cwd: repoPath, timeout: 180000, stdio: 'pipe' });
      logger.info({ repoPath }, 'npm ci complete');
    } else if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      execSync('npm install --no-audit', { cwd: repoPath, timeout: 180000, stdio: 'pipe' });
      logger.info({ repoPath }, 'npm install complete');
    } else if (fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
      execSync('pip install -r requirements.txt -q', { cwd: repoPath, timeout: 120000, stdio: 'pipe' });
      logger.info({ repoPath }, 'pip install complete');
    } else if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
      execSync('go mod download', { cwd: repoPath, timeout: 120000, stdio: 'pipe' });
      logger.info({ repoPath }, 'go mod download complete');
    }
  } catch (err) {
    logger.warn({ err: err.message.slice(0, 300) }, 'Dependency install failed — aider will proceed without pre-installed deps');
  }
}

async function runAiderForTask(repoPath, task, context, builderConfig) {
  installDependencies(repoPath);

  // Resolve affected_files against the actual repo layout BEFORE building the
  // message so the resolved paths appear in "Relevant files:" — otherwise the
  // model might diff the original (non-existent) path and aider silently fails.
  const SEARCH_DIRS = ['', 'backend', 'ui', 'src', 'app', 'lib'];
  const existing = (task.affected_files || []).flatMap(f => {
    for (const dir of SEARCH_DIRS) {
      const candidate = dir ? path.join(dir, f) : f;
      if (fs.existsSync(path.join(repoPath, candidate))) return [candidate];
    }
    return [];
  }).slice(0, 8);

  const message = buildAiderTaskMessage(task, context, existing);
  const msgFile = path.join(repoPath, '.sentinel-aider-task.tmp');
  fs.writeFileSync(msgFile, message, 'utf8');

  const args = [
    '--model',               builderConfig.aiderModel,
    '--yes-always',
    '--auto-commits',
    '--no-browser',
    '--no-stream',
    '--edit-format',         'diff',
    '--no-check-update',
    '--no-suggest-shell-commands',
    '--message-file',        msgFile,
  ];

  if (existing.length > 0) args.push(...existing);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('aider', args, {
      cwd: repoPath,
      env: getAiderEnv(builderConfig),
    });

    proc.stdout.on('data', c => { stdout += c.toString(); });
    proc.stderr.on('data', c => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      const { sendTelegramMessage } = require('./telegramClient');
      sendTelegramMessage(
        `Project Sentinel — Aider Timeout ⏱️\n\nTask ${task.task_number}: ${task.title}\nRepo: ${context.repoName}\nAider killed after ${process.env.AIDER_TIMEOUT_MINUTES || 20}m — task skipped.`,
        null, context.topicId
      ).catch(() => {});
      proc.kill('SIGTERM');
      resolve({ success: false, reason: 'Aider timed out' });
    }, AIDER_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      try { fs.unlinkSync(msgFile); } catch (e) {}
      resolve({ success: code === 0, exitCode: code, stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, reason: err.message });
    });
  });
}

function buildAiderTaskMessage(task, context, resolvedFiles) {
  // Use resolved paths if available — these are the actual paths in the cloned
  // repo and must match what aider sees when it produces diffs.
  const filePaths = (resolvedFiles && resolvedFiles.length > 0)
    ? resolvedFiles.join(', ')
    : (task.affected_files || []).join(', ') || 'explore the repo to find relevant files';

  return `You are an autonomous code improvement agent working on ${context.projectName || context.repoName}.

TASK: ${task.title}
${task.description}

Files to edit: ${filePaths}
Acceptance criteria: ${task.acceptance_criteria || 'see description above'}

RULES:
- Make the smallest change that satisfies the task. No refactoring unrelated code.
- Do NOT touch: .env files, auth/payment logic, database migrations, Dockerfile, CI config.
- ALWAYS make at least one concrete code change and commit it — do not skip or say "already done".
- One commit only. Do NOT push.
- Do not run build, test, or install commands.`;
}

module.exports = { executeBatch };
