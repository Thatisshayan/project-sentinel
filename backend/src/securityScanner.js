const path      = require('path');
const os        = require('os');
const fs        = require('fs');
const simpleGit = require('simple-git');
const logger    = require('./logger');

const { sendTelegramMessage }                = require('./telegramClient');
const { createSecurityScan, updateSecurityScan,
        upsertSecurityScore }                = require('./securityDb');
const { scanDependencies }                   = require('./dependencyScanner');
const { scanDiff }                           = require('./secretScanner');
const { evaluateOwasp }                      = require('./owaspChecker');

function calculateSecurityScore(issues) {
  let score = 10.0;
  for (const i of issues) {
    if (i.severity === 'critical')    score -= 2.5;
    else if (i.severity === 'high')   score -= 1.5;
    else if (i.severity === 'medium') score -= 0.5;
    else if (i.severity === 'low')    score -= 0.1;
  }
  return Math.max(0, parseFloat(score.toFixed(1)));
}

async function runSecurityScan(data) {
  const {
    repoFullName, repoName, commitSha,
    branchName, topicId,
  } = data;

  logger.info({ repoFullName, commitSha: commitSha?.slice(0, 7) }, 'Security scan starting');

  const scan   = await createSecurityScan({ repoFullName, commitSha, branchName });
  let   tmpDir = null;

  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-sec-'));
    const git = simpleGit();
    await git.clone(
      `https://${process.env.GITHUB_TOKEN}@github.com/${repoFullName}.git`,
      tmpDir, ['--depth', '2']
    );

    const cloneGit = simpleGit(tmpDir);
    let diffText = '';
    try {
      diffText = await cloneGit.diff([`${commitSha}~1`, commitSha]);
    } catch {
      diffText = await cloneGit.diff(['HEAD~1', 'HEAD']).catch(() => '');
    }

    const fileList = (await cloneGit.raw(['ls-files'])).split('\n').filter(Boolean);

    const [depResult, secretResult, owaspResult] = await Promise.allSettled([
      scanDependencies(tmpDir, repoFullName, scan.id),
      scanDiff(diffText, repoFullName, scan.id, commitSha),
      evaluateOwasp(repoName, tmpDir, fileList),
    ]);

    const allIssues = [
      ...(depResult.status    === 'fulfilled' ? depResult.value    : []),
      ...(secretResult.status === 'fulfilled' ? secretResult.value : []),
    ];

    const owaspScore = owaspResult.status === 'fulfilled'
      ? owaspResult.value.owaspScore : null;

    const securityScore = calculateSecurityScore(allIssues);

    const counts = {
      critical: allIssues.filter(i => i.severity === 'critical').length,
      high:     allIssues.filter(i => i.severity === 'high').length,
      medium:   allIssues.filter(i => i.severity === 'medium').length,
      low:      allIssues.filter(i => i.severity === 'low').length,
    };

    await updateSecurityScan(scan.id, {
      security_score:   securityScore,
      vulnerabilities:  allIssues.filter(i => i.issueType === 'vulnerability').length,
      secrets_found:    allIssues.filter(i => i.issueType === 'secret').length,
      owasp_score:      owaspScore,
      scan_duration_ms: Date.now() - new Date(scan.triggered_at).getTime(),
      status:           'complete',
      completed_at:     new Date().toISOString(),
    });

    await upsertSecurityScore(repoName, { score: securityScore, vulnerabilities: allIssues.length, ...counts });

    const critical = allIssues.filter(i => i.severity === 'critical');
    const high     = allIssues.filter(i => i.severity === 'high');

    if (critical.length > 0 || high.length > 0) {
      const lines = [
        `🔒 Security Scan — ${repoName}`,
        `Security Score: ${securityScore}/10`,
        '',
      ];
      if (critical.length > 0) {
        lines.push(`🔴 CRITICAL (${critical.length}):`);
        critical.slice(0, 3).forEach(i => lines.push(`  · ${i.title}`));
        if (critical.length > 3) lines.push(`  · ...and ${critical.length - 3} more`);
        lines.push('');
      }
      if (high.length > 0) {
        lines.push(`🟠 HIGH (${high.length}):`);
        high.slice(0, 3).forEach(i => lines.push(`  · ${i.title}`));
        if (high.length > 3) lines.push(`  · ...and ${high.length - 3} more`);
        lines.push('');
      }
      lines.push(`/sentinel security ${repoName} — full details`);
      // Critical always alerts to main group (topicId null)
      const alertTopic = critical.length > 0 ? null : topicId;
      await sendTelegramMessage(lines.join('\n'), null, alertTopic).catch(() => {});
    }

    logger.info({ repoFullName, securityScore, ...counts }, 'Security scan complete');
    return { securityScore, issues: allIssues, counts };

  } catch (err) {
    logger.error({ err: err.message, repoFullName }, 'Security scan failed');
    await updateSecurityScan(scan.id, { status: 'failed' }).catch(() => {});
    return null;
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = { runSecurityScan };
