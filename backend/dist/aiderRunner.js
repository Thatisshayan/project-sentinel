"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const child_process_1 = require("child_process");
const simple_git_1 = __importDefault(require("simple-git"));
const tmp_1 = __importDefault(require("tmp"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = __importDefault(require("./logger"));
const riskAssessor_1 = require("./riskAssessor");
const childEnv_1 = require("./utils/childEnv");
const TIMEOUT_MS = () => parseInt(process.env['DEBUG_TIMEOUT_MINUTES'] || '30') * 60 * 1000;
const AIDER_MODEL = () => process.env['AIDER_MODEL'] || 'openai/meta/llama-3.1-70b-instruct';
function buildAiderMessage(context) {
    const { failureReason, failureLogs, changedFiles, buildProvider, attemptNumber } = context;
    return `You are an autonomous build repair agent. A build has failed. Fix it.

BUILD FAILURE CONTEXT:
Provider: ${buildProvider}
Attempt: ${attemptNumber}/5
Failure reason: ${failureReason || 'See logs below'}

BUILD LOGS:
${(0, riskAssessor_1.sanitizeLogs)(failureLogs ?? null) || 'No logs available'}

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
async function runAider(repoPath, context) {
    return new Promise((resolve) => {
        const model = AIDER_MODEL();
        const message = buildAiderMessage(context);
        // Write message to a temp file to avoid shell escaping issues
        const msgFile = path_1.default.join(repoPath, '.sentinel-aider-msg.tmp');
        fs_1.default.writeFileSync(msgFile, message, 'utf8');
        // gemini/gemini-2.5-pro supports SEARCH/REPLACE natively; whole format works for anything else
        const isCodeSpecialist = /gemini|codestral|qwen.*coder|deepseek.*coder/i.test(model);
        const editFormat = isCodeSpecialist ? 'diff' : 'whole';
        const args = [
            '--model', model,
            '--yes-always',
            '--no-browser',
            '--no-stream',
            '--auto-commits',
            '--no-check-update',
            '--no-suggest-shell-commands',
            '--edit-format', editFormat,
            '--map-tokens', '2048',
            '--message-file', msgFile,
        ];
        // Add specific files if we know which ones to focus on
        if (context.changedFiles && context.changedFiles.length > 0) {
            const existingFiles = context.changedFiles.filter(f => fs_1.default.existsSync(path_1.default.join(repoPath, f)));
            args.push(...existingFiles.slice(0, 10)); // max 10 files
        }
        logger_1.default.info({ model, repoPath, attempt: context.attemptNumber }, 'Starting Aider');
        let stdout = '';
        let stderr = '';
        // NVIDIA NIM is OpenAI-compatible — Aider talks to it via the 'openai/' model
        // prefix, so we point the OpenAI client at NIM's base URL and hand it the
        // NVIDIA key. Falls back to a real OPENAI_API_KEY/base if someone points
        // AIDER_MODEL at an actual OpenAI model instead.
        const usingNvidia = model.startsWith('openai/') && !!process.env['NVIDIA_API_KEY'];
        const proc = (0, child_process_1.spawn)('aider', args, {
            cwd: repoPath,
            env: (0, childEnv_1.buildChildEnv)({
                // Pass API keys Aider needs based on model
                GEMINI_API_KEY: process.env['GEMINI_API_KEY'] || '',
                ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] || '',
                OPENAI_API_KEY: usingNvidia ? process.env['NVIDIA_API_KEY'] : (process.env['OPENAI_API_KEY'] || ''),
                ...(usingNvidia ? {
                    OPENAI_API_BASE: 'https://integrate.api.nvidia.com/v1',
                    OPENAI_BASE_URL: 'https://integrate.api.nvidia.com/v1',
                } : {}),
            }),
        });
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            logger_1.default.warn({ attempt: context.attemptNumber }, 'Aider timed out — killed');
            resolve({
                success: false,
                reason: 'timeout',
                stdout: stdout.slice(-2000),
                stderr: stderr.slice(-2000),
            });
        }, TIMEOUT_MS());
        proc.on('close', (code) => {
            clearTimeout(timer);
            // Clean up temp message file
            try {
                fs_1.default.unlinkSync(msgFile);
            }
            catch (e) { }
            logger_1.default.info({ code, attempt: context.attemptNumber }, 'Aider process exited');
            resolve({
                success: code === 0,
                exitCode: code,
                stdout: stdout.slice(-5000),
                stderr: stderr.slice(-2000),
                reason: code === 0 ? null : `Aider exited with code ${code}`,
            });
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            logger_1.default.error({ err: err.stack ?? err.message }, 'Failed to spawn Aider process');
            resolve({
                success: false,
                reason: `Failed to spawn Aider: ${err.message}`,
                stdout: '',
                stderr: '',
            });
        });
    });
}
async function cloneAndFix(context) {
    const { repoFullName, branchName, attemptNumber } = context;
    const tmpDir = tmp_1.default.dirSync({ unsafeCleanup: true, prefix: 'sentinel-' });
    try {
        logger_1.default.info({ repoFullName, tmpDir: tmpDir.name }, 'Cloning repo');
        const cloneUrl = `https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`;
        const git = (0, simple_git_1.default)();
        // Clone with depth 1 for speed
        await git.clone(cloneUrl, tmpDir.name, ['--depth', '1', '--branch', branchName]);
        const repoGit = (0, simple_git_1.default)(tmpDir.name);
        // Configure git identity for commits
        await repoGit.addConfig('user.email', 'sentinel@project-sentinel.app');
        await repoGit.addConfig('user.name', 'Project Sentinel');
        // Record the base commit SHA before branching so we can detect new commits
        const baseLog = await repoGit.log({ maxCount: 1 });
        const baseSha = baseLog.latest?.hash || null;
        // Create fix branch
        const fixBranch = `sentinel/fix-${attemptNumber}-${Date.now()}`;
        await repoGit.checkoutLocalBranch(fixBranch);
        // Run Aider
        const aiderResult = await runAider(tmpDir.name, context);
        if (!aiderResult.success) {
            return {
                status: 'failed',
                reason: aiderResult.reason ?? undefined,
                fixBranch,
                aiderOutput: aiderResult.stdout,
            };
        }
        // Detect new commits by comparing HEAD SHA to the pre-branch base SHA.
        // diffSummary([branch, fixBranch]) is unreliable in shallow clones when
        // aider makes no commits (refs are identical, diff is empty but fn can
        // behave unexpectedly), so we compare SHAs directly instead.
        const log = await repoGit.log({ maxCount: 1 });
        const latestCommit = log.latest;
        if (!latestCommit || latestCommit.hash === baseSha) {
            logger_1.default.warn({
                repoFullName,
                attempt: attemptNumber,
                aiderTail: aiderResult.stdout?.slice(-1000),
            }, 'Aider made no new commits — cannot_fix');
            return {
                status: 'cannot_fix',
                reason: 'Aider ran successfully but made no new commits — could not identify a safe fix',
                fixBranch,
                aiderOutput: aiderResult.stdout,
            };
        }
        // Push fix branch to GitHub
        await repoGit.push('origin', fixBranch);
        logger_1.default.info({ fixBranch, commitSha: latestCommit.hash }, 'Fix branch pushed to GitHub');
        return {
            status: 'fixed',
            fixBranch,
            commitSha: latestCommit.hash,
            commitMessage: latestCommit.message,
            filesChanged: await getChangedFiles(repoGit),
            aiderOutput: aiderResult.stdout,
        };
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message, repoFullName }, 'cloneAndFix failed');
        return {
            status: 'error',
            reason: err.message,
        };
    }
    finally {
        // Always clean up temp directory
        try {
            tmpDir.removeCallback();
        }
        catch (e) { }
    }
}
async function getChangedFiles(git) {
    try {
        const diff = await git.diff(['HEAD~1', 'HEAD', '--name-only']);
        return diff.trim().split('\n').filter(Boolean);
    }
    catch (e) {
        return [];
    }
}
module.exports = { cloneAndFix };
//# sourceMappingURL=aiderRunner.js.map