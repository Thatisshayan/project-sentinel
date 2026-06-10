import { config } from '../config.js';
import { isHighRiskChange } from '../utils/risk.js';
import { sendMessage, buildDebuggerUpdate, buildExhaustedReport } from '../telegram/reporter.js';
import { updatePage, appendBlocks } from '../notion/client.js';

const retryStore = {};

export function getRetryState(commitHash) {
  return retryStore[commitHash] || { attempts: 0, usedAgents: [], lastAgent: null };
}

export async function triggerDebugger(event, notionPage, projectName, buildProvider, buildUrl, failureReason) {
  const commitHash = event.commitHash;
  let state = getRetryState(commitHash);

  if (state.attempts >= config.debugger.maxRetries) {
    await sendMessage(buildExhaustedReport({
      project: projectName, repo: event.repoName, branch: event.branchName,
      failedCommitUrl: event.commitUrl, attemptsUsed: state.attempts,
      lastDebugger: state.lastAgent || 'None', lastError: failureReason,
    }));
    return { fixed: false, exhausted: true };
  }

  if (isHighRiskChange(event.changedFiles, event.commitMessage)) {
    await sendMessage('Project Sentinel stopped automatic repair because the failure appears high-risk or environment-related.\nHuman review required.');
    return { fixed: false, highRisk: true };
  }

  for (const agent of config.debugger.agentOrder) {
    if (state.usedAgents.includes(agent)) continue;

    state.attempts++;
    state.lastAgent = agent;
    state.usedAgents.push(agent);
    retryStore[commitHash] = state;

    const repoDir = `/tmp/sentinel-repos/${event.repoName}`;

    try {
      await sendMessage(buildDebuggerUpdate({
        project: projectName, repo: event.repoName, debugger: agent,
        attempt: state.attempts, fixCommitted: false,
      }));

      const result = await runDebugger(agent, {
        repoUrl: event.repoUrl, repoName: event.repoName, branchName: 'main',
        commitHash, commitMessage: event.commitMessage,
        buildProvider, buildUrl, failureReason, repoDir, attempt: state.attempts,
      });

      if (result.success) {
        await sendMessage(buildDebuggerUpdate({
          project: projectName, repo: event.repoName, debugger: agent,
          attempt: state.attempts, fixCommitted: true, fixUrl: result.fixUrl,
        }));

        if (notionPage) {
          try {
            await updatePage(notionPage.id, {
              'Last Debug Attempt Count': { number: state.attempts },
              'Last Debugger Used': { select: { name: agent } },
              'Last Fix Commit URL': result.fixUrl ? { url: result.fixUrl } : undefined,
            });
            await appendBlocks(notionPage.id, [{
              bulleted_list_item: {
                rich_text: [{ text: { content: `Fix committed by ${agent} (attempt ${state.attempts}): ${result.fixUrl || 'unknown'}` } }],
              },
            }]).catch(() => {});
          } catch (e) { console.error('Notion debugger fields update failed:', e.message); }
        }

        delete retryStore[commitHash];
        return { fixed: true, agent, attempts: state.attempts, fixUrl: result.fixUrl };
      }

      console.log(`Debugger ${agent} failed: ${result.error}`);
    } catch (err) {
      console.error(`Debugger ${agent} error:`, err.message);
    }
  }

  await sendMessage(buildExhaustedReport({
    project: projectName, repo: event.repoName, branch: event.branchName,
    failedCommitUrl: event.commitUrl, attemptsUsed: state.attempts,
    lastDebugger: state.lastAgent, lastError: failureReason,
  }));

  return { fixed: false, exhausted: true, attempts: state.attempts };
}

async function runDebugger(agent, context) {
  if (agent === 'OpenCode') return runOpenCode(context);
  if (agent === 'OpenHands') return runOpenHands(context);
  return { success: false, error: `Unknown agent: ${agent}` };
}

async function runOpenCode(context) {
  const instructions = `You are debugging a failed build for ${context.repoName}.
Commit: ${context.commitHash}
Message: ${context.commitMessage}
Build provider: ${context.buildProvider}
Failure reason: ${context.failureReason}

Find the smallest safe fix. Do not refactor unnecessarily.
Do not change secrets, billing, auth, payment, or database logic unless clearly required and safe.
Report exact changes.`;

  try {
    const { execSync } = await import('child_process');

    execSync(`git clone --depth 1 ${context.repoUrl} ${context.repoDir}`, {
      timeout: 60000, stdio: 'pipe',
    });

    execSync(`git config user.email "sentinel@project-sentinel.app"`, {
      cwd: context.repoDir, stdio: 'pipe',
    });
    execSync(`git config user.name "Project Sentinel"`, {
      cwd: context.repoDir, stdio: 'pipe',
    });

    execSync(`opencode run --dangerously-skip-permissions -m opencode-go/qwen3.7-plus "${instructions}"`, {
      cwd: context.repoDir,
      timeout: 300000,
      stdio: 'pipe',
    });

    const status = execSync(`git status --porcelain`, {
      cwd: context.repoDir, encoding: 'utf-8', stdio: 'pipe',
    }).toString().trim();

    if (!status) {
      return { success: false, error: 'OpenCode made no changes' };
    }

    execSync(`git add -A`, { cwd: context.repoDir, stdio: 'pipe' });
    execSync(`git commit -m "fix(project-sentinel): repair build failure for ${context.commitHash?.slice(0, 7)}"`, {
      cwd: context.repoDir, stdio: 'pipe',
    });

    execSync(`git push origin ${context.branchName}`, {
      cwd: context.repoDir, timeout: 60000, stdio: 'pipe',
    });

    const result = execSync(`git rev-parse HEAD`, {
      cwd: context.repoDir, encoding: 'utf-8', stdio: 'pipe',
    }).toString().trim();

    return {
      success: true,
      fixUrl: `${context.repoUrl.replace('.git', '')}/commit/${result}`,
      fixMessage: `OpenCode auto-fix: ${context.commitMessage}`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try {
      const { execSync } = await import('child_process');
      execSync(`rm -rf ${context.repoDir}`, { timeout: 10000, stdio: 'pipe' }).catch(() => {});
    } catch {}
  }
}

async function runOpenHands(context) {
  const url = config.debugger.openHandsUrl;
  if (!url) return { success: false, error: 'OpenHands URL not configured' };

  try {
    const res = await fetch(`${url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: context.repoUrl,
        branch: context.branchName,
        task: `Fix the build failure for ${context.repoName}.

Commit: ${context.commitHash}
Message: ${context.commitMessage}
Build provider: ${context.buildProvider}
Failure reason: ${context.failureReason}

Find the smallest safe fix. Do not refactor unnecessarily.
Do not change secrets, billing, auth, payment, or database logic.
Commit fix to main. Push to GitHub.`,
      }),
    });

    if (!res.ok) return { success: false, error: `OpenHands API error: ${res.status}` };

    const data = await res.json();
    const sessionId = data.session_id;

    let result = { status: 'running' };
    while (result.status === 'running' || result.status === 'initializing') {
      await new Promise(r => setTimeout(r, 10000));
      const statusRes = await fetch(`${url}/api/sessions/${sessionId}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (statusRes.ok) result = await statusRes.json();
    }

    if (result.fix_committed && result.fix_url) {
      return { success: true, fixUrl: result.fix_url, fixMessage: result.fix_message || '' };
    }

    return { success: false, error: result.error || 'OpenHands did not produce a fix' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
