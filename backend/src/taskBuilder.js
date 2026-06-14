const simpleGit  = require('simple-git');
const tmp        = require('tmp');
const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const logger     = require('./logger');
const { runClaudeCodeForTask } = require('./claudeCodeRunner');
const { getBuilderConfig, getAiderEnv } = require('./builderRouter');
const { updateAuditTask }    = require('./auditDb');
const { updateNotionTaskStatus } = require('./auditTaskWriter');

async function executeBatch(tasks, context, builderAssignment) {
  const { repoFullName, branchName, projectName, repoName } = context;
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

    const taskBranch = `sentinel/batch-${batchNum}-tasks-${batchNums}`;
    await repoGit.checkoutLocalBranch(taskBranch);

    const completedTasks = [];
    let   lastCommitSha  = null;

    for (const task of tasks) {
      logger.info({ taskNumber: task.task_number, builder: builderConfig.id },
        'Executing task in batch');

      let taskResult;

      if (builderConfig.type === 'claude_code') {
        taskResult = await runClaudeCodeForTask(tmpDir.name, task, context);
      } else if (builderConfig.type === 'aider' || builderConfig.type === 'openai_compatible') {
        // openai_compatible uses aider with OPENAI_API_BASE set in getAiderEnv
        taskResult = await runAiderForTask(tmpDir.name, task, context, builderConfig);
      } else {
        taskResult = { success: false, reason: `Unknown builder type: ${builderConfig.type}` };
      }

      if (!taskResult.success) {
        logger.warn({ taskNumber: task.task_number, reason: taskResult.reason },
          'Task failed — stopping batch at this point');
        break;
      }

      const log = await repoGit.log({ maxCount: 1 });
      if (log.latest && log.latest.message.includes('sentinel')) {
        lastCommitSha = log.latest.hash;
        completedTasks.push(task);
        logger.info({ taskNumber: task.task_number, sha: lastCommitSha.slice(0, 7) },
          'Task committed');
      } else {
        logger.warn({ taskNumber: task.task_number },
          'No sentinel commit found — task may have been skipped by Claude Code');
      }
    }

    if (completedTasks.length === 0) {
      return {
        status: 'failed',
        reason: 'No tasks in the batch produced a commit',
        taskBranch,
      };
    }

    await repoGit.push('origin', taskBranch);

    logger.info({ repoFullName, taskBranch, count: completedTasks.length },
      'Batch branch pushed');

    const { query }    = require('./dbClient');
    const remaining    = await query(`
      SELECT COUNT(*) as count FROM audit_tasks at
      JOIN audit_cycles ac ON ac.id = at.audit_cycle_id
      WHERE at.repo_full_name=$1
        AND at.status='queued'
        AND at.safe_to_auto_execute=true
        AND ac.status='executing'
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

async function runAiderForTask(repoPath, task, context, builderConfig) {
  const message = buildAiderTaskMessage(task, context);
  const msgFile = path.join(repoPath, '.sentinel-aider-task.tmp');
  fs.writeFileSync(msgFile, message, 'utf8');

  const args = [
    '--model',        builderConfig.aiderModel,
    '--yes-always',
    '--no-browser',
    '--message-file', msgFile,
  ];

  const existing = (task.affected_files || [])
    .filter(f => fs.existsSync(path.join(repoPath, f)))
    .slice(0, 8);
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
      proc.kill('SIGTERM');
      resolve({ success: false, reason: 'Aider timed out' });
    }, 20 * 60 * 1000);

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

function buildAiderTaskMessage(task, context) {
  return `Improvement task on ${context.projectName || context.repoName}.

TASK ${task.task_number}/10: ${task.title}
${task.description}

Files: ${(task.affected_files || []).join(', ')}
Acceptance: ${task.acceptance_criteria}

Rules: minimal changes only. No auth/payments/.env/migrations/Dockerfile.
Run npm run build and npm test. If fail: do not commit.
Commit: feat(sentinel): ${task.title} — Task ${task.task_number}/10
One commit. Do NOT push.`;
}

module.exports = { executeBatch };
