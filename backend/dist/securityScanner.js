"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const simple_git_1 = __importDefault(require("simple-git"));
const logger_1 = __importDefault(require("./logger"));
const telegramClient_1 = require("./telegramClient");
const securityDb_1 = require("./securityDb");
const dependencyScanner_1 = require("./dependencyScanner");
const secretScanner_1 = require("./secretScanner");
const owaspChecker_1 = require("./owaspChecker");
function calculateSecurityScore(issues) {
    let score = 10.0;
    for (const i of issues) {
        if (i.severity === 'critical')
            score -= 2.5;
        else if (i.severity === 'high')
            score -= 1.5;
        else if (i.severity === 'medium')
            score -= 0.5;
        else if (i.severity === 'low')
            score -= 0.1;
    }
    return Math.max(0, parseFloat(score.toFixed(1)));
}
async function runSecurityScan(data) {
    const { repoFullName, repoName, commitSha, branchName, topicId, } = data;
    logger_1.default.info({ repoFullName, commitSha: commitSha?.slice(0, 7) }, 'Security scan starting');
    const scan = await (0, securityDb_1.createSecurityScan)({ repoFullName, commitSha, branchName });
    if (!scan) {
        logger_1.default.error({ repoFullName }, 'Failed to create security scan record');
        return null;
    }
    let tmpDir = null;
    try {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'sentinel-sec-'));
        const git = (0, simple_git_1.default)();
        await git.clone(`https://${process.env['GITHUB_TOKEN']}@github.com/${repoFullName}.git`, tmpDir, ['--depth', '2']);
        const cloneGit = (0, simple_git_1.default)(tmpDir);
        let diffText = '';
        try {
            diffText = await cloneGit.diff([`${commitSha}~1`, commitSha]);
        }
        catch {
            diffText = await cloneGit.diff(['HEAD~1', 'HEAD']).catch(() => '');
        }
        const fileList = (await cloneGit.raw(['ls-files'])).split('\n').filter(Boolean);
        const [depResult, secretResult, owaspResult] = await Promise.allSettled([
            (0, dependencyScanner_1.scanDependencies)(tmpDir, repoFullName, scan.id),
            (0, secretScanner_1.scanDiff)(diffText, repoFullName, scan.id, commitSha),
            (0, owaspChecker_1.evaluateOwasp)(repoName, tmpDir, fileList),
        ]);
        const allIssues = [
            ...(depResult.status === 'fulfilled' ? depResult.value : []),
            ...(secretResult.status === 'fulfilled' ? secretResult.value : []),
        ];
        const owaspScore = owaspResult.status === 'fulfilled'
            ? owaspResult.value.owaspScore : null;
        const securityScore = calculateSecurityScore(allIssues);
        const counts = {
            critical: allIssues.filter(i => i.severity === 'critical').length,
            high: allIssues.filter(i => i.severity === 'high').length,
            medium: allIssues.filter(i => i.severity === 'medium').length,
            low: allIssues.filter(i => i.severity === 'low').length,
        };
        await (0, securityDb_1.updateSecurityScan)(scan.id, {
            security_score: securityScore,
            vulnerabilities: allIssues.filter(i => i.issueType === 'vulnerability').length,
            secrets_found: allIssues.filter(i => i.issueType === 'secret').length,
            owasp_score: owaspScore,
            scan_duration_ms: Date.now() - new Date(scan.triggered_at).getTime(),
            status: 'complete',
            completed_at: new Date().toISOString(),
        });
        await (0, securityDb_1.upsertSecurityScore)(repoName, { score: securityScore, vulnerabilities: allIssues.length, ...counts });
        const critical = allIssues.filter(i => i.severity === 'critical');
        const high = allIssues.filter(i => i.severity === 'high');
        if (critical.length > 0 || high.length > 0) {
            const lines = [
                `🔒 Security Scan — ${repoName}`,
                `Security Score: ${securityScore}/10`,
                '',
            ];
            if (critical.length > 0) {
                lines.push(`🔴 CRITICAL (${critical.length}):`);
                critical.slice(0, 3).forEach(i => lines.push(`  · ${i.title}`));
                if (critical.length > 3)
                    lines.push(`  · ...and ${critical.length - 3} more`);
                lines.push('');
            }
            if (high.length > 0) {
                lines.push(`🟠 HIGH (${high.length}):`);
                high.slice(0, 3).forEach(i => lines.push(`  · ${i.title}`));
                if (high.length > 3)
                    lines.push(`  · ...and ${high.length - 3} more`);
                lines.push('');
            }
            lines.push(`/sentinel security ${repoName} — full details`);
            // Critical always alerts to main group (topicId null)
            const alertTopic = critical.length > 0 ? null : topicId;
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(lines.join('\n'), null, alertTopic), { label: 'securityScanner' });
        }
        logger_1.default.info({ repoFullName, securityScore, ...counts }, 'Security scan complete');
        return { securityScore, issues: allIssues, counts };
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message, repoFullName }, 'Security scan failed');
        if (scan?.id) {
            await (0, safeFire_1.safeFire)((0, securityDb_1.updateSecurityScan)(scan.id, { status: 'failed' }), { label: 'securityScanner' });
        }
        return null;
    }
    finally {
        if (tmpDir) {
            try {
                fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
            }
            catch { }
        }
    }
}
module.exports = { runSecurityScan };
//# sourceMappingURL=securityScanner.js.map