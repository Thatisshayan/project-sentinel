const { spawn }   = require('child_process');
const simpleGit   = require('simple-git');
const tmp         = require('tmp');
const path        = require('path');
const fs          = require('fs');
const logger      = require('./logger');
const { sanitizeLogs } = require('./riskAssessor');

const TIMEOUT_MS = () =>
  parseInt(process.env.DEBUG_TIMEOUT_MINUTES || '30') * 60 * 1000;

const AIDER_MODEL = () =>
  process.env.AIDER_MODEL || 'gemini/gemini-2.5-pro';

// ── Build the message Aider receives ────────────────────────────────────────

function buildAiderMessage(context) {
  const { failureReason, failureLogs, changedFiles, buildProvider, attemptNumber } = context;

  return `You are an autonomous build repair agent. A build has failed. Fix it.

BUILD FAILURE CONTEXT:
Provider: ${buildProvider}
Attempt: ${attemptNumber}/5
Failure reason: ${failureReason || 'See logs below'}

BUILD LOGS:
${sanitizeLogs(failureLogs) || 'No logs available'}

RECENTLY CHANGED FILES:
${(changedFiles || []).join('\n') || 'Unknown'}

YOUR RULES:
1. Read the failure logs above carefully. Identify the exact root cause.
2. Make the smallest possible change that fixes the identified cause.
3. Do not refactor anything unrelated to the failure.
4. Do not touch: .env files, auth logic, payment logic, database migrations, Dockerfile, CI config.
5. If you cannot identify a safe fix with high confidence, do nothing and explain why in a comment.
6. Run the build command after your fix to verify it passes before committing.
7. If tests exist (npm test), run them. If they fail, do not commit.
8. Commit message must be exactly: fix(sentinel): repair ${buildProvider} build failure — attempt ${attemptNumber}
9. Use one clean commit. Do not create multiple commits.

Start by reading the relevant files, then apply your fix.`;
}

// ── Run Aider as child process ───────────────────────────────────────────────

async function runAider(repoPath, context) {
  return new Promise((resolve) => {
    const model   = AIDER_MODEL();
    const message = buildAiderMessage(context);

    // Write message to a temp file to avoid shell escaping issues
    const msgFile = path.join(repoPath, '.sentinel-aider-msg.tmp');
    fs.writeFileSync(msgFile, message, 'utf8');

    const args = [
      '--model',       model,
      '--yes-always',
      '--no-browser',
      '--auto-commits',
      '--message-file', msgFile,
    ];

    // Add specific files if we know which ones to focus on
    if (context.changedFiles && context.changedFiles.length > 0) {
      const existingFiles = context.changedFiles.filter(f =>
        fs.existsSync(path.join(repoPath, f))
      );
      args.push(...existingFiles.slice(0, 10)); // max 10 files
    }

    logger.info({ model, repoPath, attempt: context.attemptNumber }, 'Starting Aider');

    let stdout = '';
    let stderr = '';

    const proc = spawn('aider', args, {
      cwd: repoPath,
      env: {
        ...process.env,
        // Pass API keys Aider needs based on model
        GEMINI_API_KEY:  process.env.GEMINI_API_KEY  || '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        OPENAI_API_KEY:  process.env.OPENAI_API_KEY  || '',
      },
    });

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

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

    proc.on('close', (code) => {
      clearTimeout(timer);

      // Clean up temp message file
      try { fs.unlinkSync(msgFile); } catch (e) {}

      logger.info({ code, attempt: context.attemptNumber }, 'Aider process exited');

      resolve({
        success: code === 0,
        exitCode: code,
        stdout:  stdout.slice(-5000),
        stderr:  stderr.slice(-2000),
        reason:  code === 0 ? null : `Aider exited with code ${code}`,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      logger.error({ err: err.message }, 'Failed to spawn Aider process');
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

async function cloneAndFix(context) {
  const { repoFullName, branchName, attemptNumber } = context;
  const tmpDir = tmp.dirSync({ unsafeCleanup: true, prefix: 'sentinel-' });

  try {
    logger.info({ repoFullName, tmpDir: tmpDir.name }, 'Cloning repo');

    const cloneUrl = `https://${process.env.GITHUB_TOKEN}@github.com/${repoFullName}.git`;
    const git = simpleGit();

    // Clone with depth 1 for speed
    await git.clone(cloneUrl, tmpDir.name, ['--depth', '1', '--branch', branchName]);

    const repoGit = simpleGit(tmpDir.name);

    // Configure git identity for commits
    await repoGit.addConfig('user.email', 'sentinel@project-sentinel.app');
    await repoGit.addConfig('user.name',  'Project Sentinel');

    // Create fix branch
    const fixBranch = `sentinel/fix-${attemptNumber}-${Date.now()}`;
    await repoGit.checkoutLocalBranch(fixBranch);

    // Run Aider
    const aiderResult = await runAider(tmpDir.name, context);

    if (!aiderResult.success) {
      return {
        status:         'failed',
        reason:         aiderResult.reason,
        fixBranch,
        aiderOutput:    aiderResult.stdout,
      };
    }

    // Check if Aider made any commits by comparing fix branch to base branch
    const diffSummary = await repoGit.diffSummary([branchName, fixBranch]);
    const hasChanges = diffSummary.files.length > 0;

    if (!hasChanges) {
      return {
        status:      'cannot_fix',
        reason:      'Aider ran successfully but made no changes — could not identify a safe fix',
        fixBranch,
        aiderOutput: aiderResult.stdout,
      };
    }

    // Get the latest commit on fix branch
    const log = await repoGit.log({ maxCount: 1 });
    const latestCommit = log.latest;

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

  } catch (err) {
    logger.error({ err: err.message, repoFullName }, 'cloneAndFix failed');
    return {
      status: 'error',
      reason: err.message,
    };
  } finally {
    // Always clean up temp directory
    try { tmpDir.removeCallback(); } catch (e) {}
  }
}

async function getChangedFiles(git) {
  try {
    const diff = await git.diff(['HEAD~1', 'HEAD', '--name-only']);
    return diff.trim().split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

module.exports = { cloneAndFix };
