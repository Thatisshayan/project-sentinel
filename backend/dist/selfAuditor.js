"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const axios_1 = __importDefault(require("axios"));
const repoResolver_1 = require("./repoResolver");
const telegramClient_1 = require("./telegramClient");
const claudeCodeAudit_1 = require("./claudeCodeAudit");
const auditTaskWriter_1 = require("./auditTaskWriter");
const auditDb_1 = require("./auditDb");
const selfAuditDb_1 = require("./selfAuditDb");
const SENTINEL_NAME = 'project-sentinel';
const SENTINEL_REPO = (0, repoResolver_1.repoFullName)(SENTINEL_NAME);
async function runSelfAudit() {
    logger_1.default.info('Starting Sentinel self-audit');
    const selfCycle = await (0, selfAuditDb_1.createSelfAuditCycle)();
    try {
        const commitRes = await axios_1.default.get(`https://api.github.com/repos/${SENTINEL_REPO}/commits/main`, {
            headers: {
                Authorization: `Bearer ${process.env['GITHUB_TOKEN']}`,
                Accept: 'application/vnd.github+json',
            },
            timeout: 15000,
        });
        const commitSha = commitRes.data.sha;
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `🛡️ Sentinel Self-Audit Starting`,
            ``,
            `Nemotron is auditing Sentinel's own codebase.`,
            `This is Phase 7 — Sentinel improves itself.`,
        ].join('\n'), null, null), { label: 'selfAuditor' });
        const auditResult = await (0, claudeCodeAudit_1.runAudit)({
            repoFullName: SENTINEL_REPO,
            repoName: SENTINEL_NAME,
            projectName: 'Project Sentinel',
            commitSha,
            commitMessage: 'Self-audit',
            branchName: 'main',
        });
        const cycleSha = `${commitSha}-self-${Date.now()}`;
        const auditCycle = await (0, auditDb_1.createAuditCycle)({
            repoFullName: SENTINEL_REPO,
            commitSha: cycleSha,
            projectName: 'Project Sentinel',
        });
        if (!auditCycle) {
            logger_1.default.warn({ cycleSha }, 'Could not create self-audit cycle — tasks will be written to Notion only');
        }
        const writeResult = await (0, auditTaskWriter_1.writeTasksToNotion)(auditResult, auditCycle?.id || null, {
            repoFullName: SENTINEL_REPO,
            repoName: SENTINEL_NAME,
            projectName: 'Project Sentinel',
            commitSha,
            notionParentPageId: null,
            builderAgent: 'qwen_coder',
            source: 'Sentinel Self-Audit',
        });
        if (auditCycle) {
            const safeCount = auditResult.tasks.filter((t) => t.safeToAutoExecute).length;
            await (0, auditDb_1.updateAuditCycle)(auditCycle.id, {
                status: 'awaiting_approval',
                health_score: auditResult.overallHealthScore,
                audit_summary: auditResult.auditSummary,
                tasks_total: auditResult.tasks.length,
                tasks_safe: safeCount,
                approval_sent_at: new Date().toISOString(),
            });
        }
        await (0, selfAuditDb_1.updateSelfAuditCycle)(selfCycle.id, {
            status: 'complete',
            health_score: auditResult.overallHealthScore,
            audit_summary: auditResult.auditSummary,
            tasks_generated: auditResult.tasks.length,
            completed_at: new Date().toISOString(),
        });
        const safeCount = auditResult.tasks.filter((t) => t.safeToAutoExecute).length;
        const taskLines = auditResult.tasks.map((t, i) => `${i + 1}. [${t.priority}] ${t.title}`).join('\n');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `🛡️ Sentinel Self-Audit Complete`,
            ``,
            `Health Score: ${auditResult.overallHealthScore}/10`,
            ``,
            auditResult.auditSummary,
            ``,
            `${auditResult.tasks.length} self-improvement tasks:`,
            taskLines,
            ``,
            `Safe to auto-execute: ${safeCount}/${auditResult.tasks.length}`,
            ``,
            `⚠️ These tasks modify Sentinel itself.`,
            `Review carefully before approving.`,
            ``,
            `/sentinel self-approve — execute safe tasks`,
            `/sentinel skip project-sentinel — skip this cycle`,
        ].join('\n'), null, null), { label: 'selfAuditor' });
        logger_1.default.info({ cycleId: selfCycle.id, tasks: auditResult.tasks.length, score: auditResult.overallHealthScore }, 'Self-audit complete');
    }
    catch (err) {
        logger_1.default.error({ err: err.stack ?? err.message }, 'Self-audit failed');
        await (0, safeFire_1.safeFire)((0, selfAuditDb_1.updateSelfAuditCycle)(selfCycle.id, { status: 'failed' }), { label: 'selfAuditor' });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`🛡️ Sentinel Self-Audit Failed\n\nError: ${err.message.substring(0, 200)}`, null, null), { label: 'selfAuditor' });
    }
}
module.exports = { runSelfAudit };
//# sourceMappingURL=selfAuditor.js.map