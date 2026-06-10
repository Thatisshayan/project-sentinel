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
      project: projectName,
      repo: event.repoName,
      branch: event.branchName,
      failedCommitUrl: event.commitUrl,
      attemptsUsed: state.attempts,
      lastDebugger: state.lastAgent || 'None',
      lastError: failureReason,
    }));
    return { fixed: false, exhausted: true };
  }

  if (isHighRiskChange(event.changedFiles, event.commitMessage)) {
    await sendMessage('Project Sentinel stopped automatic repair because the failure appears high-risk or environment-related.\nHuman review required.');
    return { fixed: false, highRisk: true };
  }

  const agentOrder = config.debugger.agentOrder;

  for (const agent of agentOrder) {
    if (state.usedAgents.includes(agent)) continue;

    state.attempts++;
    state.lastAgent = agent;
    state.usedAgents.push(agent);
    retryStore[commitHash] = state;

    const repoDir = `/tmp/sentinel-repos/${event.repoName}`;

    try {
      await sendMessage(buildDebuggerUpdate({
        project: projectName,
        repo: event.repoName,
        debugger: agent,
        attempt: state.attempts,
        fixCommitted: false,
      }));

      const result = await runDebugger(agent, {
        repoUrl: event.repoUrl,
        repoName: event.repoName,
        branchName: 'main',
        commitHash,
        commitMessage: event.commitMessage,
        buildProvider,
        buildUrl,
        failureReason,
        repoDir,
        attempt: state.attempts,
      });

      if (result.success) {
        await sendMessage(buildDebuggerUpdate({
          project: projectName,
          repo: event.repoName,
          debugger: agent,
          attempt: state.attempts,
          fixCommitted: true,
          fixUrl: result.fixUrl,
        }));

        if (notionPage) {
          try {
            await updatePage(notionPage.id, {
              'Last Debug Attempt Count': { number: state.attempts },
              'Last Debugger Used': { select: { name: agent } },
              'Last Fix Commit URL': result.fixUrl ? { url: result.fixUrl } : undefined,
            });
            const fixBlocks = [
              {
                bulleted_list_item: {
                  rich_text: [{ text: { content: `Fix committed by ${agent} (attempt ${state.attempts}): ${result.fixUrl || 'unknown'}` } }],
                },
              },
            ];
            await appendBlocks(notionPage.id, fixBlocks).catch(() => {});
          } catch (e) {
            console.error('Failed to update notion debugger fields:', e.message);
          }
        }

        delete retryStore[commitHash];
        return { fixed: true, agent, attempts: state.attempts, fixUrl: result.fixUrl };
      }

      console.log(`Debugger ${agent} failed to fix: ${result.error}`);
    } catch (err) {
      console.error(`Debugger ${agent} error:`, err.message);
    }
  }

  await sendMessage(buildExhaustedReport({
    project: projectName,
    repo: event.repoName,
    branch: event.branchName,
    failedCommitUrl: event.commitUrl,
    attemptsUsed: state.attempts,
    lastDebugger: state.lastAgent,
    lastError: failureReason,
  }));

  return { fixed: false, exhausted: true, attempts: state.attempts };
}

async function runDebugger(agent, context) {
  const agentCommands = {
    OpenCode: 'opencode',
    'Kilo CLI': 'kilo',
    Kiro: 'kiro',
  };

  const command = agentCommands[agent];
  if (!command) return { success: false, error: `Unknown agent: ${agent}` };

  const instructions = `You are debugging a failed build for ${context.repoName}.
Commit: ${context.commitHash}
Message: ${context.commitMessage}
Build provider: ${context.buildProvider}
Failure reason: ${context.failureReason}

Find the smallest safe fix. Do not refactor unnecessarily.
Do not change secrets, billing, auth, payment, or database logic unless clearly required and safe.
Commit fix to main only if safe.
Push to GitHub.
Report exact changes.`;

  try {
    const { execSync } = await import('child_process');

    await execSync(`git clone --depth 1 ${context.repoUrl} ${context.repoDir}`, {
      cwd: '/tmp',
      timeout: 60000,
      stdio: 'pipe',
    });

    await execSync(`cd ${context.repoDir} && ${command} "${instructions}"`, {
      timeout: 300000,
      stdio: 'pipe',
      env: { ...process.env, OPENCODE_HOME: process.env.OPENCODE_HOME || '' },
    });

    const result = execSync(`cd ${context.repoDir} && git log -1 --format="%H %s"`, {
      timeout: 10000,
      encoding: 'utf-8',
    }).toString().trim();

    const [fixHash, ...fixMsgParts] = result.split(' ');
    const fixMessage = fixMsgParts.join(' ');

    if (fixHash && fixHash.length === 40) {
      return {
        success: true,
        fixUrl: `${context.repoUrl.replace('.git', '')}/commit/${fixHash}`,
        fixMessage,
      };
    }

    return { success: false, error: 'No fix commit detected' };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try {
      const { execSync } = await import('child_process');
      await execSync(`rm -rf ${context.repoDir}`, { timeout: 10000, stdio: 'pipe' }).catch(() => {});
    } catch {}
  }
}
