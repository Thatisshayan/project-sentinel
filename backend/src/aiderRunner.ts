import { spawn } from 'child_process';
import simpleGit from 'simple-git';
import tmp from 'tmp';
import path from 'path';
import fs from 'fs';
import logger from './logger';
import { sanitizeLogs } from './riskAssessor';
import { getBuilderConfig, getAiderEnv, getFallbackBuilder } from './builderRouter';
import loopGuard from './utils/loopGuard';

const TIMEOUT_MS = (): number =>
  parseInt(process.env['DEBUG_TIMEOUT_MINUTES'] || '30') * 60 * 1000;

// ── Build the message Aider receives ────────────────────────────────────────

interface AiderContext {
  failureReason?: string;
  failureLogs?: string;
  changedFiles?: string[];
  buildProvider?: string;
  attemptNumber?: number;
  repoFullName?: string;
  repoName?: string;
  branchName?: string;
  projectMemoryText?: string;
}

function buildAiderMessage(context: AiderContext): string {
  const { failureReason, failureLogs, changedFiles, buildProvider, attemptNumber, projectMemoryText } = context;

  return `You are an autonomous build repair agent. A build has failed. Fix it.
${projectMemoryText ? `\n${projectMemoryText}\n` : ''}

BUILD FAILURE CONTEXT:
Provider: ${buildProvider}
Attempt: ${attemptNumber}/5
Failure reason: ${failureReason || 'See logs below'}

BUILD LOGS:
${sanitizeLogs(failureLogs ?? null) || 'No logs available'}

RECENTLY CHANGED FILES:
${(changedFiles || []).join('\n') || 'Unknown'}

YOUR RULES:
1. Read the failure logs above carefully. Identify the exact root cause.
2. Make the smallest possible change that fixes the identified cause.
3. Do not refactor anything unrelated to the failure.
4. Do not touch: .env files, auth logic, payment logic, database migrations, Dockerfile, CI config.
5. If you cannot identify a safe fix with high confidence, do nothing and explain why in a comment.
6. Do NOT run npm install, npm test, npm run build, or any shell commands. The CI will verify.
7. Output the ENTIRE contents of each changed file — no elisions, no "..." placeholders.
8. Use one clean commit only. Do not create multiple commits.
9. Do NOT push.

Start by reading the relevant files, then apply your fix.`;
}

// ── Run Aider as child process ───────────────────────────────────────────────

interface AiderResult {
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  reason?: string | null;
}

async function runAider(repoPath: string, context: AiderContext, builderId?: string): Promise<AiderResult> {
  return new Promise((resolve) => {
    // Shares builderRouter.ts's verified-working model pool and fallback
    // chain with taskBuilder.ts's audit-fix path, instead of this file's
    // previous standalone AIDER_MODEL env var — that var had drifted to
    // 'deepseek/deepseek-chat' (a leftover Railway override) with zero
    // fallback, silently routing every build-failure repair to DeepSeek
    // after Shayan asked for it to be removed from the pool (2026-07-29).
    const builderConfig = getBuilderConfig(builderId);
    const model = builderConfig.aiderModel || 'openai/meta/llama-3.1-70b-instruct';
    const message = buildAiderMessage(context);

    // Write message to a temp file to avoid shell escaping issues
    const msgFile = path.join(repoPath, '.sentinel-aider-msg.tmp');
    fs.writeFileSync(msgFile, message, 'utf8');

    const editFormat = builderConfig.editFormat || 'whole';

    const args = [
      '--model',       model,
      '--yes-always',
      '--no-browser',
      '--no-stream',
      '--auto-commits',
      '--no-check-update',
      '--no-suggest-shell-commands',
      '--edit-format',  editFormat,
      '--map-tokens',  '2048',
      '--message-file', msgFile,
    ];

    // Add specific files if we know which ones to focus on
    if (context.changedFiles && context.changedFiles.length > 0) {
      const existingFiles = context.changedFiles.filter(f =>
        fs.existsSync(path.join(repoPath, f))
      );
      args.push(...existingFiles.slice(0, 10)); // max 10 files
    }

    logger.info({ model, builder: builderConfig.id, repoPath, attempt: context.attemptNumber }, 'Starting Aider');

    let stdout = '';
    let stderr = '';

    const proc = spawn('aider', args, {
      cwd: repoPath,
      env: getAiderEnv(builderConfig),
    });

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      logger.warn({ attempt: context.attemptNumber }, 'Aider timed out — killed');
      resolve({
        success:    false,
        reason:     'timeout',
        stdout:     stdout.slice(-2000),
        stderr:     stderr.slice(-2000),
      });
    }, TIMEOUT_MS());

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);

      // Clean up temp message file
      try { fs.unlinkSync(msgFile); } catch (e: any) {
        logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e), msgFile }, 'aiderRunner: message-file cleanup failed');
      }

      logger.info({ code, attempt: context.attemptNumber }, 'Aider process exited');

      resolve({
        success: code === 0,
        exitCode: code,
        stdout:  stdout.slice(-5000),
        stderr:  stderr.slice(-2000),
        reason:  code === 0 ? null : `Aider exited with code ${code}`,
      });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      logger.error({ err: err.stack ?? err.message }, 'Failed to spawn Aider process');
      resolve({
        success: false,
        reason:  `Failed to spawn Aider: ${err.message}`,
        stdout:  '',
        stderr:  '',
      });
    });
  });
}

// ── Clone repo and run Aider ─────────────────────────────────────────────────

interface CloneResult {
  status: string;
  reason?: string;
  fixBranch?: string;
  aiderOutput?: string;
  commitSha?: string;
  commitMessage?: string;
  filesChanged?: string[];
}

async function cloneAndFix(context: AiderContext): Promise<CloneResult> {
  const { repoFullName, branchName, attemptNumber } = context;
  const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: 'sentinel-' });

  try {
    logger.info({ repoFullName, tmpDir: tmpDir.name }, 'Cloning repo');

    // D-027 item 6 (project memory) — recorded conventions/dismissed
    // findings for this repo, fed into the debug-fix prompt the same way
    // taskBuilder.ts's audit-task path already does.
    const projectMemoryModule = require('./projectMemory');
    context.projectMemoryText = await projectMemoryModule.getMemoryForPrompt(repoFullName!).catch(() => '');

    const cloneUrl = `https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`;
    const git = simpleGit();

    // Clone with depth 1 for speed
    await git.clone(cloneUrl, tmpDir.name, ['--depth', '1', '--branch', branchName!]);

    const repoGit = simpleGit(tmpDir.name);

    // Configure git identity for commits
    await repoGit.addConfig('user.email', 'sentinel@project-sentinel.app');
    await repoGit.addConfig('user.name',  'Project Sentinel');

    // Record the base commit SHA before branching so we can detect new commits
    const baseLog = await repoGit.log({ maxCount: 1 });
    const baseSha = baseLog.latest?.hash || null;

    // Create fix branch
    const fixBranch = `sentinel/fix-${attemptNumber}-${Date.now()}`;
    await repoGit.checkoutLocalBranch(fixBranch);

    // Run Aider, retrying with a fallback builder if the model call itself
    // fails or exits cleanly without committing — mirrors taskBuilder.ts's
    // retry-with-fallback logic for the audit-fix path. No numeric attempt
    // cap: walks the full fallback chain (see builderRouter.ts) until either
    // a commit lands or every builder with a configured key has been tried.
    let builderId: string | undefined;
    let aiderResult: AiderResult = { success: false };
    let latestCommit: any = null;
    let attempt = 0;
    const triedBuilders: string[] = [];
    const guard = new loopGuard.LoopGuard({
      label: 'aiderRunner-fallback',
      maxIterations: loopGuard.DEFAULT_MAX_ITERATIONS(),
      onEscalate: async ({ iterations }) => {
        const { sendTelegramMessage } = require('./telegramClient');
        sendTelegramMessage(
          `🚨 Project Sentinel — Loop Escalation\n\nRepo: ${repoFullName}\nBuild-fix attempt ${attemptNumber} exceeded ${iterations} builder-fallback attempts without a commit. Stopping and needs human attention.`,
          context.repoName || repoFullName || null, null
        ).catch((err: any) => logger.warn({ err: err.message }, 'aiderRunner: loop-escalation Telegram alert failed'));
      },
    });

    for (;;) {
      if (!(await guard.tick({ repoFullName, attemptNumber }))) break;
      attempt++;
      triedBuilders.push(builderId || 'nvidia');
      aiderResult = await runAider(tmpDir.name, context, builderId);

      if (aiderResult.success) {
        const log = await repoGit.log({ maxCount: 1 });
        latestCommit = log.latest;
        if (latestCommit && latestCommit.hash !== baseSha) break;
      }

      const currentId = builderId || 'nvidia';
      const next = getFallbackBuilder(currentId, triedBuilders);
      if (!next) break;
      logger.warn({ repoFullName, attempt, failedBuilder: currentId, fallingBackTo: next },
        'Debug-fix builder failed or produced no commit — retrying with fallback');
      builderId = next;
    }

    if (!aiderResult.success) {
      return {
        status:         'failed',
        reason:         aiderResult.reason ?? undefined,
        fixBranch,
        aiderOutput:    aiderResult.stdout,
      };
    }

    if (!latestCommit || latestCommit.hash === baseSha) {
      logger.warn({
        repoFullName,
        attempt: attemptNumber,
        aiderTail: aiderResult.stdout?.slice(-1000),
      }, 'Aider made no new commits — cannot_fix');
      return {
        status:      'cannot_fix',
        reason:      'Aider ran successfully but made no new commits — could not identify a safe fix',
        fixBranch,
        aiderOutput: aiderResult.stdout,
      };
    }

    // Push fix branch to GitHub
    await repoGit.push('origin', fixBranch);

    logger.info(
      { fixBranch, commitSha: latestCommit.hash },
      'Fix branch pushed to GitHub'
    );

    return {
      status:        'fixed',
      fixBranch,
      commitSha:     latestCommit.hash,
      commitMessage: latestCommit.message,
      filesChanged:  await getChangedFiles(repoGit),
      aiderOutput:   aiderResult.stdout,
    };

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message, repoFullName }, 'cloneAndFix failed');
    return {
      status: 'error',
      reason: err.message,
    };
  } finally {
    // Always clean up temp directory
    try { tmpDir.removeCallback(); } catch (e: any) {
      logger.warn({ err: e instanceof Error ? (e.stack ?? e.message) : String(e) }, 'aiderRunner: tmpDir cleanup failed');
    }
  }
}

async function getChangedFiles(git: ReturnType<typeof simpleGit>): Promise<string[]> {
  try {
    const diff = await git.diff(['HEAD~1', 'HEAD', '--name-only']);
    return diff.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

export = { cloneAndFix };

