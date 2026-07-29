import { safeFire, fireAndForget } from './utils/safeFire';
import simpleGit from 'simple-git';
import tmp from 'tmp';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import logger from './logger';
import { runClaudeCodeForTask } from './claudeCodeRunner';
import { getBuilderConfig, getAiderEnv, getFallbackBuilder } from './builderRouter';
import { updateAuditTask } from './auditDb';
import { updateNotionTaskStatus } from './auditTaskWriter';
import { execAsync } from './utils/execAsync';

const AIDER_TIMEOUT_MS: number = parseInt(process.env['AIDER_TIMEOUT_MINUTES'] || '20', 10) * 60 * 1000;

async function resetWorkingTree(repoGit: ReturnType<typeof simpleGit>, taskNumber: number): Promise<void> {
  try {
    await repoGit.reset(['--hard', 'HEAD']);
    await repoGit.clean('f', ['-d']);
  } catch (e: any) {
    logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e), taskNumber },
      'taskBuilder: failed to reset working tree after a failed/no-commit attempt');
  }
}

async function executeBatch(tasks: any[], context: any, builderAssignment: string): Promise<any> {
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
    const cloneUrl = `https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`;
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

    const completedTasks: any[] = [];
    let   lastCommitSha: string | null  = null;
    let   lastTaskStdout = '';
    let   lastTaskStderr = '';

    for (const task of tasks) {
      let attemptBuilder = builderConfig;
      let taskResult: any;
      let attempt = 0;
      let taskCommitted = false;
      const triedBuilders: string[] = [];

      for (;;) {
        attempt++;
        triedBuilders.push(attemptBuilder.id);
        logger.info({ taskNumber: task.task_number, builder: attemptBuilder.id, attempt },
          'Executing task in batch');

        // Send heartbeat every 2 minutes so Telegram isn't silent during long runs
        const heartbeatStart = Date.now();
        const heartbeatTimer = topicId
          ? setInterval(() => {
              const elapsed = Math.round((Date.now() - heartbeatStart) / 60000);
              const { sendTelegramMessage } = require('./telegramClient');
              fireAndForget(sendTelegramMessage(
                `Agent working on task ${task.task_number}/${tasks.length} — ${task.title}\nElapsed: ${elapsed}m | Builder: ${attemptBuilder.label}`,
                repoName, topicId
              ), { label: 'taskBuilder' })
            }, 2 * 60 * 1000)
          : null;

        try {
          if (attemptBuilder.type === 'claude_code') {
            taskResult = await runClaudeCodeForTask(tmpDir.name, task, context);
          } else if (attemptBuilder.type === 'aider' || attemptBuilder.type === 'openai_compatible') {
            // openai_compatible uses aider with OPENAI_API_BASE set in getAiderEnv
            taskResult = await runAiderForTask(tmpDir.name, task, context, attemptBuilder);
          } else {
            taskResult = { success: false, reason: `Unknown builder type: ${attemptBuilder.type}` };
          }
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }

        lastTaskStdout = (taskResult.stdout || '').slice(-1500);
        lastTaskStderr = (taskResult.stderr || '').slice(-1500);

        // A "success" from the runner isn't good enough on its own — also
        // require a new commit before treating this attempt as done, so a
        // model that exits 0 without editing anything still triggers fallback.
        let committed = false;
        if (taskResult.success) {
          const log = await repoGit.log({ maxCount: 1 });
          const headSha = log.latest?.hash || null;
          committed = !!headSha && headSha !== (lastCommitSha || initialBaseSha);
          if (committed) {
            lastCommitSha = headSha;
          }
        }

        if (committed) { taskCommitted = true; break; }

        const reason = !taskResult.success
          ? (taskResult.reason || `${attemptBuilder.label} exit code ${taskResult.exitCode}`)
          : `${attemptBuilder.label} exited cleanly but produced no commit`;

        // No numeric attempt cap — walk the full fallback chain (currently
        // ~22 models: see builderRouter.ts). Pass every builder tried so far
        // in this task (not just the one that just failed) — getFallbackBuilder
        // excludes all of them, so the walk actually reaches deeper into the
        // pool instead of bouncing back to an already-tried builder.
        const nextBuilderId = getFallbackBuilder(attemptBuilder.id, triedBuilders);
        const nextBuilder = nextBuilderId ? getBuilderConfig(nextBuilderId) : null;

        if (!nextBuilder || triedBuilders.includes(nextBuilder.id)) {
          logger.warn({
            taskNumber:  task.task_number,
            reason,
            triedBuilders,
            stdoutTail:  lastTaskStdout,
            stderrTail:  lastTaskStderr,
          }, 'Task failed on every available builder — giving up on this task');
          break;
        }

        logger.warn({ taskNumber: task.task_number, failedBuilder: attemptBuilder.id, reason, fallingBackTo: nextBuilder.id },
          'Builder failed or produced no commit — retrying with fallback builder');
        // A failed/no-commit attempt can leave tracked or untracked changes
        // behind (e.g. a partial edit the model made before erroring) — reset
        // so the next fallback model starts from the same committed baseline
        // instead of an accumulating dirty worktree. Confirmed as a real risk
        // by Qodo (2026-07-29), more likely now that this loop tries many
        // models per task.
        await resetWorkingTree(repoGit, task.task_number);
        attemptBuilder = nextBuilder;
      }

      if (taskCommitted) {
        completedTasks.push(task);
        logger.info({ taskNumber: task.task_number, sha: (lastCommitSha || '').slice(0, 7), builder: attemptBuilder.id },
          'Task committed');
      } else {
        // No commit on any attempted builder — check working tree state for diagnostics
        let gitStatus = '';
        try {
          const st = await repoGit.status();
          gitStatus = `modified:${st.modified.length} new:${st.created.length} staged:${(st.staged||[]).length}`;
        } catch (e: any) {
          logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e) }, 'taskBuilder: git status check failed, continuing without gitStatus detail');
        }
        logger.warn({
          taskNumber: task.task_number,
          stdoutTail: lastTaskStdout,
          stderrTail: lastTaskStderr,
          gitStatus,
          triedBuilders,
        }, 'No new commit found — task may have been skipped by every attempted builder');
        // Log to agent_messages for UI visibility
        const { logAgentMessage } = require('./agentDb');
        await safeFire(logAgentMessage(
          'sentinel', 'Sentinel',
          `Task ${task.task_number} "${task.title}" produced no commit after trying builders: ${triedBuilders.join(', ')} (${gitStatus}).\nStdout:\n${(taskResult.stdout||'').slice(-600)}\nStderr:\n${(taskResult.stderr||'').slice(-200)}`,
          'error', context.repoName
        ), { label: 'taskBuilder' })
        // Reset before moving to the next task for the same reason as above —
        // this task's final failed attempt shouldn't leak into the next task.
        await resetWorkingTree(repoGit, task.task_number);
        // Every remaining task is worth trying independently (different tasks may
        // suit different models), so continue the batch rather than aborting it.
        continue;
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
        fireAndForget(sendTelegramMessage(
          `Project Sentinel — Merge Conflict Risk ⚠️\n\nRepo: ${repoName}\nBase branch moved while the batch was running.\nThe PR may have conflicts — review before merging.`,
          repoName, topicId
        ), { label: 'taskBuilder' })
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Could not check for base branch changes');
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

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message, repoFullName }, 'executeBatch threw an error');
    return { status: 'error', reason: err.message };
  } finally {
    try { tmpDir.removeCallback(); } catch (e: any) {
      logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e), repoFullName }, 'taskBuilder: tmpDir cleanup failed');
    }
  }
}

async function installDependencies(repoPath: string): Promise<void> {
  try {
    if (fs.existsSync(path.join(repoPath, 'package-lock.json'))) {
      await execAsync('npm ci --prefer-offline --no-audit', { cwd: repoPath, timeout: 180000, scoped: true });
      logger.info({ repoPath }, 'npm ci complete');
    } else if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      await execAsync('npm install --no-audit', { cwd: repoPath, timeout: 180000, scoped: true });
      logger.info({ repoPath }, 'npm install complete');
    } else if (fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
      await execAsync('pip install -r requirements.txt -q', { cwd: repoPath, timeout: 120000, scoped: true });
      logger.info({ repoPath }, 'pip install complete');
    } else if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
      await execAsync('go mod download', { cwd: repoPath, timeout: 120000, scoped: true });
      logger.info({ repoPath }, 'go mod download complete');
    }
  } catch (err: any) {
    logger.warn({ err: err.message.slice(0, 300) }, 'Dependency install failed — aider will proceed without pre-installed deps');
  }
}

async function runAiderForTask(repoPath: string, task: any, context: any, builderConfig: any): Promise<any> {
  await installDependencies(repoPath);

  // Resolve affected_files against the actual repo layout BEFORE building the
  // message so the resolved paths appear in "Relevant files:" — otherwise the
  // model might diff the original (non-existent) path and aider silently fails.
  // Check both flat-repo and monorepo paths. Ordered: exact match first, then
  // common monorepo subdirs, then shallow roots.
  const SEARCH_DIRS = [
    '', 'backend/src', 'backend', 'frontend/src', 'frontend',
    'ui/src', 'ui', 'server/src', 'server',
    'src', 'app', 'lib',
  ];
  const existing: string[] = (task.affected_files || []).flatMap((f: string) => {
    for (const dir of SEARCH_DIRS) {
      const candidate = dir ? path.join(dir, f) : f;
      if (fs.existsSync(path.join(repoPath, candidate))) return [candidate];
    }
    return [];
  }).slice(0, 8);

  const message = buildAiderTaskMessage(task, context, existing);
  const msgFile = path.join(repoPath, '.sentinel-aider-task.tmp');
  fs.writeFileSync(msgFile, message, 'utf8');

  // 'whole' instructs aider to output the complete file contents after edits —
  // any instruction-following model can do this. 'diff' (SEARCH/REPLACE blocks)
  // is more token-efficient but requires models specifically trained on the format
  // (e.g. qwen2.5-coder); generic models like llama/mistral fail silently.
  const editFormat = builderConfig.editFormat || 'whole';

  const args = [
    '--model',               builderConfig.aiderModel,
    '--yes-always',
    '--auto-commits',
    '--no-browser',
    '--no-stream',
    '--edit-format',         editFormat,
    '--no-check-update',
    '--no-suggest-shell-commands',
    '--map-tokens',          '2048',
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

    proc.stdout.on('data', (c: any) => { stdout += c.toString(); });
    proc.stderr.on('data', (c: any) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      const { sendTelegramMessage } = require('./telegramClient');
      fireAndForget(sendTelegramMessage(
        `Project Sentinel — Aider Timeout ⏱️\n\nTask ${task.task_number}: ${task.title}\nRepo: ${context.repoName}\nAider killed after ${process.env['AIDER_TIMEOUT_MINUTES'] || 20}m — task skipped.`,
        context.repoName, context.topicId
      ), { label: 'taskBuilder' })
      proc.kill('SIGTERM');
      resolve({ success: false, reason: 'Aider timed out' });
    }, AIDER_TIMEOUT_MS);

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      try { fs.unlinkSync(msgFile); } catch (e: any) {
        logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e), msgFile }, 'taskBuilder: aider message-file cleanup failed');
      }
      resolve({ success: code === 0, exitCode: code, stdout, stderr });
    });

    proc.on('error', (err: any) => {
      clearTimeout(timer);
      resolve({ success: false, reason: err.message });
    });
  });
}

function buildAiderTaskMessage(task: any, context: any, resolvedFiles: string[]): string {
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
- Read each file listed above. Make the minimal targeted change that satisfies the task.
- Output the ENTIRE contents of each changed file — no elisions, no "..." placeholders.
- Do NOT touch: .env files, auth/payment logic, database migrations, Dockerfile, CI config.
- ALWAYS make at least one concrete code change. Do not say "already done" or skip.
- One commit only. Do NOT push. Do not run build, test, or install commands.`;
}

export = { executeBatch };

