import path from 'path';
import os from 'os';
import fs from 'fs';
import simpleGit from 'simple-git';
import logger from './logger';

import { sendTelegramMessage } from './telegramClient';
import { createSecurityScan, updateSecurityScan, upsertSecurityScore } from './securityDb';
import { scanDependencies } from './dependencyScanner';
import { scanDiff } from './secretScanner';
import { evaluateOwasp } from './owaspChecker';

interface ScanData {
  repoFullName: string;
  repoName: string;
  commitSha: string;
  branchName: string;
  topicId?: any;
}

interface SecurityIssue {
  severity: string;
  issueType: string;
  title: string;
  [key: string]: any;
}

interface ScanCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function calculateSecurityScore(issues: SecurityIssue[]): number {
  let score = 10.0;
  for (const i of issues) {
    if (i.severity === 'critical')    score -= 2.5;
    else if (i.severity === 'high')   score -= 1.5;
    else if (i.severity === 'medium') score -= 0.5;
    else if (i.severity === 'low')    score -= 0.1;
  }
  return Math.max(0, parseFloat(score.toFixed(1)));
}

async function runSecurityScan(data: ScanData) {
  const {
    repoFullName, repoName, commitSha,
    branchName, topicId,
  } = data;

  logger.info({ repoFullName, commitSha: commitSha?.slice(0, 7) }, 'Security scan starting');

  const scan   = await createSecurityScan({ repoFullName, commitSha, branchName });
  if (!scan) {
    logger.error({ repoFullName }, 'Failed to create security scan record');
    return null;
  }
  let   tmpDir: string | null = null;

  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-sec-'));
    const git = simpleGit();
    await git.clone(
      `https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`,
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

    const allIssues: SecurityIssue[] = [
      ...(depResult.status    === 'fulfilled' ? depResult.value    : []),
      ...(secretResult.status === 'fulfilled' ? secretResult.value : []),
    ];

    const owaspScore = owaspResult.status === 'fulfilled'
      ? owaspResult.value.owaspScore : null;

    const securityScore = calculateSecurityScore(allIssues);

    const counts: ScanCounts = {
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

  } catch (err: any) {
    logger.error({ err: err.message, repoFullName }, 'Security scan failed');
    if (scan?.id) {
      await updateSecurityScan(scan.id, { status: 'failed' }).catch(() => {});
    }
    return null;
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }
}

export = { runSecurityScan };
