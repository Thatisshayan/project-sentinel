import { query } from './dbClient';
import logger from './logger';

async function initDefaultPrompts(): Promise<void> {
  const existing = await query(
    'SELECT COUNT(*) as count FROM prompt_versions WHERE is_active = true'
  );
  if (parseInt(existing.rows[0]?.count || '0') > 0) return;

  const defaults = [
    { promptType: 'audit',      content: 'DEFAULT_AUDIT_PROMPT' },
    { promptType: 'build_task', content: 'DEFAULT_BUILD_PROMPT' },
  ];

  for (const p of defaults) {
    await query(`
      INSERT INTO prompt_versions (prompt_type, version, content, is_active)
      VALUES ($1, 1, $2, true)
    `, [p.promptType, p.content]);
  }

  logger.info('Default prompts initialised');
}

async function recordPromptOutcome(promptType: string, success: boolean): Promise<void> {
  await query(`
    UPDATE prompt_versions SET
      sample_count     = sample_count + 1,
      avg_success_rate = COALESCE(
        (COALESCE(avg_success_rate, 0) * sample_count + $2) / (sample_count + 1),
        $2
      )
    WHERE prompt_type = $1 AND is_active = true
  `, [promptType, success ? 100 : 0]);
}

async function getPromptStats(): Promise<any[]> {
  const r = await query(`
    SELECT prompt_type, version, avg_success_rate, sample_count
    FROM prompt_versions
    WHERE is_active = true
    ORDER BY prompt_type
  `);
  return r.rows;
}

async function getPromptReport(): Promise<string> {
  const stats = await getPromptStats();
  if (stats.length === 0) return 'No prompt data yet.';

  const lines = stats.map((p: any) =>
    `· ${p.prompt_type} v${p.version}: ${parseFloat(p.avg_success_rate || 0).toFixed(1)}% success (${p.sample_count} samples)`
  ).join('\n');

  return `📝 Prompt Performance\n\n${lines}`;
}

export = { initDefaultPrompts, recordPromptOutcome, getPromptReport };
