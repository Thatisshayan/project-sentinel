const { Client } = require('@notionhq/client');
const logger     = require('./logger');
const { checkDuplicateTask, createAuditTask } = require('./auditDb');

const notion      = () => new Client({ auth: process.env.NOTION_API_KEY });
const TASKS_DB_ID = () => {
  const raw = process.env.NOTION_TASKS_DATABASE_ID || process.env.NOTION_DATABASE_ID || '';
  // Strip full Notion URL to bare ID if someone pastes the URL instead of the UUID
  if (raw.startsWith('http')) {
    return raw.split('/').pop();
  }
  return raw;
};

const PRIORITY_EMOJI = {
  critical: '🔴', high: '🟠', medium: '🟡', low: '🟢',
};

async function writeTasksToNotion(auditResult, auditCycleId, payload) {
  const {
    repoFullName, projectName, repoName,
    commitSha, notionParentPageId, builderAgent,
  } = payload;

  const written = [];
  const skipped = [];
  const failed  = [];

  const batchSize = parseInt(process.env.TASK_BATCH_SIZE || '5');

  for (const task of auditResult.tasks) {
    const batchNumber = Math.ceil(task.taskNumber / batchSize);

    const isDuplicate = await checkDuplicateTask(repoFullName, task.title);
    if (isDuplicate) {
      skipped.push({ taskNumber: task.taskNumber, title: task.title });
      logger.info({ title: task.title }, 'Skipping duplicate task');
      continue;
    }

    let notionPageId = null;
    try {
      const page = await notion().pages.create({
        parent:     { database_id: TASKS_DB_ID() },
        properties: buildNotionProperties(task, {
          projectName, repoName, commitSha, builderAgent, batchNumber,
        }),
        children: [buildNotionBody(task)],
      });
      notionPageId = page.id;
    } catch (err) {
      logger.warn({ taskNumber: task.taskNumber, err: err.message },
        'Failed to write task to Notion — continuing');
      failed.push({
        taskNumber: task.taskNumber, title: task.title, reason: err.message,
      });
    }

    try {
      await createAuditTask({
        auditCycleId,
        repoFullName,
        taskNumber:          task.taskNumber,
        title:               task.title,
        description:         task.description,
        priority:            task.priority,
        category:            task.category,
        affectedFiles:       task.affectedFiles,
        complexity:          task.estimatedComplexity,
        safeToAutoExecute:   task.safeToAutoExecute,
        safetyReason:        task.safetyReason,
        acceptanceCriteria:  task.acceptanceCriteria,
        batchNumber,
        builderAgent:        builderAgent || 'claude',
        notionPageId,
      });
      written.push({ taskNumber: task.taskNumber, title: task.title, notionPageId });
    } catch (err) {
      logger.error({ taskNumber: task.taskNumber, err: err.message },
        'Failed to save task to database');
    }
  }

  return { written, skipped, failed };
}

function buildNotionProperties(task, meta) {
  const { projectName, repoName, commitSha, builderAgent, batchNumber } = meta;
  const emoji = PRIORITY_EMOJI[task.priority] || '⚪';

  return {
    'Name': {
      title: [{ text: { content: `${emoji} [Batch ${batchNumber}] ${task.title}` } }],
    },
    'Status':               { select: { name: 'Queued' } },
    'Priority':             { select: { name: task.priority } },
    'Category':             { select: { name: task.category || 'code-quality' } },
    'Complexity':           { select: { name: task.estimatedComplexity || 'medium' } },
    'Safe to Auto-Execute': { select: { name: task.safeToAutoExecute ? 'Yes' : 'No' } },
    'Source':               { select: { name: 'Project Sentinel Audit' } },
    'Assigned Builder':     { select: { name: builderAgent || 'claude' } },
    'Batch':                { number: batchNumber },
    'Task Number':          { number: task.taskNumber },
    'Audit Commit':         {
      rich_text: [{ text: { content: (commitSha || '').substring(0, 7) } }],
    },
    'Repo Name':            {
      rich_text: [{ text: { content: repoName || '' } }],
    },
  };
}

function buildNotionBody(task) {
  return {
    object: 'block',
    type:   'callout',
    callout: {
      rich_text: [{
        type: 'text',
        text: {
          content: [
            `Description:\n${task.description}`,
            `\n\nAffected Files:\n${(task.affectedFiles || []).join(', ') || 'Not specified'}`,
            `\n\nAcceptance Criteria:\n${task.acceptanceCriteria || 'Not specified'}`,
            `\n\nSafety Note:\n${task.safetyReason || 'N/A'}`,
          ].join(''),
        },
      }],
      icon:  { emoji: '📋' },
      color: 'default',
    },
  };
}

async function updateNotionTaskStatus(notionPageId, status, extra = {}) {
  if (!notionPageId) return;
  try {
    const STATUS_MAP = {
      in_progress: 'In Progress',
      build_check: 'Build Check',
      done:        'Done',
      failed:      'Failed',
      skipped:     'Skipped',
      queued:      'Queued',
    };
    const props = {
      'Status': { select: { name: STATUS_MAP[status] || status } },
    };
    if (extra.prUrl)         props['PR URL']         = { url: extra.prUrl };
    if (extra.commitUrl)     props['Commit URL']     = { url: extra.commitUrl };
    if (extra.failureReason) props['Failure Reason'] = {
      rich_text: [{ text: { content: extra.failureReason.substring(0, 500) } }],
    };
    await notion().pages.update({ page_id: notionPageId, properties: props });
  } catch (err) {
    logger.warn({ err: err.message, notionPageId },
      'Could not update Notion task status');
  }
}

module.exports = { writeTasksToNotion, updateNotionTaskStatus };
