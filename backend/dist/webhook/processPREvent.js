"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processPREvent = processPREvent;
const safeFire_1 = require("../utils/safeFire");
const telegramClient_1 = require("../telegramClient");
const logger_1 = __importDefault(require("../logger"));
const dbClient_1 = __importDefault(require("../dbClient"));
const auditTaskWriter_1 = require("../auditTaskWriter");
const { query } = dbClient_1.default;
async function processPREvent(payload) {
    const { action, pull_request: pr, repository } = payload;
    if (!pr || !repository)
        return;
    const repoFullName = repository.full_name;
    const branchName = pr.head?.ref || '';
    const prUrl = pr.html_url;
    const prNumber = pr.number;
    const merged = pr.merged;
    const repoName = repository.name;
    if (!branchName.startsWith('sentinel/'))
        return;
    if (action !== 'closed')
        return;
    logger_1.default.info({ repoFullName, prNumber, merged, branch: branchName }, 'Sentinel PR closed');
    if (merged) {
        const updated = await query(`
      UPDATE audit_tasks
      SET status = 'done', updated_at = NOW()
      WHERE repo_full_name = $1
        AND (pr_url = $2 OR pr_number = $3)
        AND status IN ('build_check', 'in_progress')
      RETURNING id, notion_page_id
    `, [repoFullName, prUrl, prNumber]).catch(() => null);
        const taskIds = updated?.rows || [];
        logger_1.default.info({ count: taskIds.length, repoFullName }, 'Tasks marked done after PR merge');
        for (const row of taskIds) {
            await (0, safeFire_1.safeFire)((0, auditTaskWriter_1.updateNotionTaskStatus)(row.notion_page_id, 'done', { prUrl }), { label: 'webhook' });
        }
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Project Sentinel — PR Merged ✅`,
            ``,
            `Repo: ${repoName}`,
            `PR #${prNumber} merged`,
            `Branch: ${branchName}`,
            taskIds.length > 0 ? `${taskIds.length} task(s) marked complete` : '',
            ``,
            `Next batch will run on next commit or /sentinel run-sprint ${repoName}`,
        ].filter(Boolean).join('\n'), null, null), { label: 'webhook' });
    }
    else {
        const updated = await query(`
      UPDATE audit_tasks
      SET status = 'queued', branch_name = NULL, commit_sha = NULL,
          pr_url = NULL, pr_number = NULL, updated_at = NOW()
      WHERE repo_full_name = $1
        AND (pr_url = $2 OR pr_number = $3)
        AND status IN ('build_check', 'in_progress')
      RETURNING id
    `, [repoFullName, prUrl, prNumber]).catch(() => null);
        const count = updated?.rows?.length || 0;
        logger_1.default.info({ count, repoFullName }, 'Tasks requeued after PR rejection');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)([
            `Project Sentinel — PR Rejected ⚠️`,
            ``,
            `Repo: ${repoName}`,
            `PR #${prNumber} closed without merging`,
            `Branch: ${branchName}`,
            count > 0 ? `${count} task(s) requeued — /sentinel run-sprint ${repoName} to retry` : '',
        ].filter(Boolean).join('\n'), null, null), { label: 'webhook' });
    }
}
//# sourceMappingURL=processPREvent.js.map