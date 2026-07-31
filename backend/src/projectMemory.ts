import dbClient from './dbClient';
import logger from './logger';

const { query } = dbClient;

// D-027 item 6 (project memory) — Shayan, 2026-07-29: "how can we give
// memory to the agents to remember the context?... repo and project memory
// suddenly popped up to my head." Scoped to the REPO (not a branch, which
// Sentinel deletes-and-recreates per the no-auto-merge design), so a
// dismissed false positive or a recorded convention survives across every
// branch/PR cycle for that repo. This is deliberately separate from
// conversationMemory.ts, which is Telegram chat Q&A memory, not
// engineering/audit/build context.

const MAX_ENTRIES_IN_PROMPT = 20;

type MemoryType = 'dismissed_finding' | 'convention' | 'decision' | 'note';

interface ProjectMemoryRow {
  id: number;
  repo_full_name: string;
  type: string;
  content: string;
  added_by: string | null;
  created_at: string;
}

async function initMemorySchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS project_memory (
      id             SERIAL PRIMARY KEY,
      repo_full_name TEXT NOT NULL,
      type           TEXT NOT NULL DEFAULT 'note',
      content        TEXT NOT NULL,
      added_by       TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_project_memory_repo
      ON project_memory (repo_full_name, created_at DESC);
  `);
  logger.info('Project memory schema initialised');
}

async function addMemoryEntry(repoFullName: string, type: MemoryType, content: string, addedBy?: string): Promise<ProjectMemoryRow | null> {
  const r = await query(`
    INSERT INTO project_memory (repo_full_name, type, content, added_by)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [repoFullName, type, content, addedBy || null]);
  logger.info({ repoFullName, type }, 'Project memory entry added');
  return r.rows[0] || null;
}

async function getMemoryEntries(repoFullName: string, limit: number = MAX_ENTRIES_IN_PROMPT): Promise<ProjectMemoryRow[]> {
  const r = await query(`
    SELECT * FROM project_memory
    WHERE repo_full_name = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [repoFullName, limit]);
  return r.rows;
}

async function deleteMemoryEntry(repoFullName: string, id: number): Promise<boolean> {
  const r = await query(
    'DELETE FROM project_memory WHERE id = $1 AND repo_full_name = $2 RETURNING id',
    [id, repoFullName]
  );
  return r.rows.length > 0;
}

const TYPE_LABELS: Record<MemoryType, string> = {
  dismissed_finding: 'Known false positive (do NOT re-flag)',
  convention:        'Project convention',
  decision:          'Prior decision',
  note:              'Note',
};

/**
 * Formats this repo's memory as a prompt-ready block, for injection into
 * audit, self-review, and build-agent prompts — so a dismissed finding or a
 * recorded convention doesn't get silently re-raised or re-violated by the
 * next agent that touches this repo, even on a brand-new branch.
 */
async function getMemoryForPrompt(repoFullName: string): Promise<string> {
  const entries = await getMemoryEntries(repoFullName).catch((err: any) => {
    logger.warn({ err: err.message, repoFullName }, 'Could not load project memory — proceeding without it');
    return [];
  });
  if (entries.length === 0) return '';

  const lines = entries.map((e) => `- [${TYPE_LABELS[e.type as MemoryType] || e.type}] ${e.content}`);
  return `PROJECT MEMORY (recorded context for this repo — respect these; don't re-raise dismissed findings or violate recorded conventions):\n${lines.join('\n')}`;
}

export = {
  initMemorySchema, addMemoryEntry, getMemoryEntries, deleteMemoryEntry, getMemoryForPrompt,
};
