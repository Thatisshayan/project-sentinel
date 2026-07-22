// Phase 6 of docs/2026-07-22-slack-agent-roster-plan.md — Viktor AI
// delegate-CEO authority. This is a real authority grant (Viktor can trigger
// production actions from a Slack message), not a notification feature, so
// this module is built fail-closed at every layer:
//
//   1. Nothing executes unless VIKTOR_SLACK_USER_ID is configured (empty by
//      design — see viktorWatcher.ts's header for why this could not be
//      verified against the real workspace this session).
//   2. Nothing executes if Sentinel is paused (system_settings.sentinel_paused
//      — see repoOps.ts's 'pause'/'resume' cases, which now set this flag).
//   3. Nothing executes unless a matching, enabled viktor_authority row
//      exists for the requested action_type, and the request fits within
//      that row's max_scope. No row = denied, not "ask a human" — bounded
//      authority, not blanket, per the plan's explicit requirement.
//   4. Every decision (approved AND denied) is logged to agent_authority_log
//      — this table is the audit trail the plan calls "non-negotiable."
//
// Default seed data ships every action_type DISABLED (enabled=false). The
// owner turns rows on deliberately (via direct SQL or a future settings
// command — not built here) once they've decided what Viktor should
// actually be allowed to do. This avoids guessing at "safe" scope limits
// (e.g. what counts as a safe security patch) that nobody has confirmed.

import dbClient from './dbClient';
import logger from './logger';

const { query } = dbClient;

interface ViktorAuthorityRule {
  id: number;
  actionType: string;
  maxScope: Record<string, any> | null;
  canDelegateTo: string[] | null;
  enabled: boolean;
}

interface AuthorityLogEntry {
  actor: string;
  action: string;
  targetRepo: string | null;
  targetAgent: string | null;
  decision: 'approved' | 'denied' | 'executed' | 'execution_failed';
  reasoning: string;
}

async function initViktorAuthoritySchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS viktor_authority (
      id               SERIAL PRIMARY KEY,
      action_type      TEXT NOT NULL,
      max_scope        JSONB,
      can_delegate_to  TEXT[],
      enabled          BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_viktor_authority_action_type
      ON viktor_authority (action_type);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agent_authority_log (
      id            SERIAL PRIMARY KEY,
      actor         TEXT NOT NULL,
      action        TEXT NOT NULL,
      target_repo   TEXT,
      target_agent  TEXT,
      decision      TEXT NOT NULL,
      reasoning     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed the three action types the plan doc names explicitly, all
  // disabled by default — see file header for why. ON CONFLICT DO NOTHING
  // (not DO UPDATE, unlike external_agents' seed) because these rows are
  // meant to be hand-tuned by the owner once enabled; a redeploy should
  // never silently reset a scope/can_delegate_to change back to the seed.
  const seed: Array<[string, Record<string, any> | null, string[] | null]> = [
    ['sprint_approve', { max_tasks: 5 }, null],
    ['security_patch', {}, null],
    ['delegate', {}, []],
  ];
  for (const [actionType, maxScope, canDelegateTo] of seed) {
    await query(
      `INSERT INTO viktor_authority (action_type, max_scope, can_delegate_to, enabled)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (action_type) DO NOTHING`,
      [actionType, maxScope ? JSON.stringify(maxScope) : null, canDelegateTo]
    );
  }
}

async function getAuthorityRule(actionType: string): Promise<ViktorAuthorityRule | null> {
  const r = await query(`SELECT * FROM viktor_authority WHERE action_type = $1`, [actionType]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    actionType: row.action_type,
    maxScope: row.max_scope,
    canDelegateTo: row.can_delegate_to,
    enabled: row.enabled,
  };
}

/**
 * Checks whether a Viktor-initiated action is within its configured
 * authority. `scope` is compared against the rule's max_scope: every
 * numeric key present in max_scope must have a scope value <= the limit.
 * No rule, or a disabled rule, means denied — there is no implicit-allow
 * path.
 */
async function checkAuthority(
  actionType: string,
  scope: Record<string, number> = {}
): Promise<{ allowed: boolean; reason: string; rule: ViktorAuthorityRule | null }> {
  const rule = await getAuthorityRule(actionType).catch((err: any) => {
    logger.error({ err: err.message, actionType }, 'viktor_authority lookup failed — denying');
    return null;
  });

  if (!rule) return { allowed: false, reason: `No authority rule configured for '${actionType}'`, rule: null };
  if (!rule.enabled) return { allowed: false, reason: `Authority rule for '${actionType}' is disabled`, rule };

  if (rule.maxScope) {
    for (const [key, limit] of Object.entries(rule.maxScope)) {
      const requested = scope[key];
      if (typeof limit === 'number' && typeof requested === 'number' && requested > limit) {
        return { allowed: false, reason: `${key}=${requested} exceeds max_scope limit ${limit}`, rule };
      }
    }
  }

  return { allowed: true, reason: 'within configured authority', rule };
}

async function canDelegateTo(agentId: string): Promise<boolean> {
  const rule = await getAuthorityRule('delegate').catch(() => null);
  if (!rule || !rule.enabled) return false;
  return Array.isArray(rule.canDelegateTo) && rule.canDelegateTo.includes(agentId);
}

async function logAuthorityAction(entry: AuthorityLogEntry): Promise<void> {
  await query(
    `INSERT INTO agent_authority_log (actor, action, target_repo, target_agent, decision, reasoning)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.actor, entry.action, entry.targetRepo, entry.targetAgent, entry.decision, entry.reasoning]
  ).catch((err: any) => {
    // A logging failure must not be silently invisible for an
    // authority-grant feature — but it also shouldn't be allowed to crash
    // whatever action already happened (or was denied). Log loudly to the
    // app's own logger as a fallback trail.
    logger.error({ err: err.message, entry }, 'CRITICAL: agent_authority_log write failed — action above is NOT recorded in the DB audit trail');
  });
}

async function getRecentAuthorityLog(limit = 20, repoName?: string | null): Promise<any[]> {
  const r = repoName
    ? await query(
        `SELECT * FROM agent_authority_log WHERE target_repo = $1 ORDER BY created_at DESC LIMIT $2`,
        [repoName, limit]
      )
    : await query(`SELECT * FROM agent_authority_log ORDER BY created_at DESC LIMIT $1`, [limit]);
  return r.rows;
}

async function listAuthorityRules(): Promise<ViktorAuthorityRule[]> {
  const r = await query(`SELECT * FROM viktor_authority ORDER BY action_type`);
  return r.rows.map((row: any) => ({
    id: row.id,
    actionType: row.action_type,
    maxScope: row.max_scope,
    canDelegateTo: row.can_delegate_to,
    enabled: row.enabled,
  }));
}

export {
  initViktorAuthoritySchema,
  checkAuthority,
  canDelegateTo,
  logAuthorityAction,
  getRecentAuthorityLog,
  listAuthorityRules,
};
