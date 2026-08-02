import dbClient from './dbClient';
import logger from './logger';

const { query } = dbClient;

type BoardroomEventType =
  | 'repo_onboarded'
  | 'push_received'
  | 'audit_started'
  | 'audit_completed'
  | 'task_created'
  | 'task_updated'
  | 'sprint_started'
  | 'sprint_updated'
  | 'decision_recorded'
  | 'risk_recorded'
  | 'kpi_recorded'
  | 'agent_action'
  | 'local_state'
  | 'security_event';

interface BoardroomAgentSeed {
  id: string;
  agentKind: 'internal' | 'external' | 'assistant' | 'human';
  agentKey: string;
  displayName: string;
  channel?: string | null;
  capabilities?: string[];
}

async function initBoardroomSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_projects (
      id                   TEXT PRIMARY KEY,
      repo_full_name       TEXT NOT NULL UNIQUE,
      repo_name            TEXT NOT NULL,
      display_name         TEXT NOT NULL,
      owner                TEXT,
      status               TEXT NOT NULL DEFAULT 'active',
      priority             TEXT DEFAULT 'medium',
      health_score         NUMERIC(4,1),
      current_phase        TEXT,
      current_milestone_id INTEGER,
      active_release_id    INTEGER,
      current_audit_aspect TEXT,
      last_commit_sha      TEXT,
      last_activity_at     TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_milestones (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'planned',
      target_date      DATE,
      progress         NUMERIC(5,2) DEFAULT 0,
      owner_agent_id   TEXT,
      source           TEXT,
      source_ref       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_releases (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      version          TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'planned',
      target_date      DATE,
      released_at      TIMESTAMPTZ,
      release_notes    TEXT,
      linked_milestone_id INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_risks (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      severity         TEXT NOT NULL DEFAULT 'medium',
      category         TEXT,
      title            TEXT NOT NULL,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'open',
      mitigation       TEXT,
      owner_agent_id   TEXT,
      source           TEXT,
      source_ref       TEXT,
      detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at      TIMESTAMPTZ,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_decisions (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      decision_type    TEXT NOT NULL DEFAULT 'general',
      title            TEXT NOT NULL,
      context          TEXT,
      decision         TEXT NOT NULL,
      rationale        TEXT,
      status           TEXT NOT NULL DEFAULT 'active',
      decided_by       TEXT,
      supersedes_decision_id INTEGER,
      source           TEXT,
      source_ref       TEXT,
      decided_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_technical_debt_items (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      description      TEXT,
      severity         TEXT DEFAULT 'medium',
      estimated_effort TEXT,
      status           TEXT NOT NULL DEFAULT 'open',
      related_code_area TEXT,
      created_from     TEXT,
      owner_agent_id   TEXT,
      source_ref       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_kpis (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      value            NUMERIC(14,4),
      unit             TEXT,
      period_start     DATE,
      period_end       DATE,
      target_value     NUMERIC(14,4),
      status           TEXT DEFAULT 'tracking',
      source           TEXT,
      source_ref       TEXT,
      recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_roadmap_items (
      id               SERIAL PRIMARY KEY,
      project_id       TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      description      TEXT,
      priority         TEXT DEFAULT 'medium',
      status           TEXT NOT NULL DEFAULT 'planned',
      quarter          TEXT,
      depends_on_item_id INTEGER,
      source           TEXT,
      source_ref       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_tasks (
      id                   SERIAL PRIMARY KEY,
      project_id           TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      task_type            TEXT NOT NULL,
      title                TEXT NOT NULL,
      description          TEXT,
      priority             TEXT DEFAULT 'medium',
      status               TEXT NOT NULL DEFAULT 'queued',
      source               TEXT,
      source_ref           TEXT,
      safe_to_auto_execute BOOLEAN DEFAULT false,
      owner_agent_id       TEXT,
      execution_agent_id   TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_agents (
      id              TEXT PRIMARY KEY,
      agent_kind      TEXT NOT NULL DEFAULT 'internal',
      agent_key       TEXT NOT NULL,
      display_name    TEXT NOT NULL,
      channel         TEXT,
      capabilities    TEXT[],
      enabled         BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_agent_actions (
      id                SERIAL PRIMARY KEY,
      project_id        TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      agent_id          TEXT NOT NULL REFERENCES boardroom_agents(id) ON DELETE CASCADE,
      action_type       TEXT NOT NULL,
      input_ref         TEXT,
      output_ref        TEXT,
      status            TEXT NOT NULL DEFAULT 'recorded',
      task_id           INTEGER,
      decision_id       INTEGER,
      started_at        TIMESTAMPTZ,
      completed_at      TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_evidence_artifacts (
      id                  SERIAL PRIMARY KEY,
      project_id          TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      artifact_type       TEXT NOT NULL,
      title               TEXT NOT NULL,
      uri                 TEXT,
      content_hash        TEXT,
      summary             TEXT,
      related_entity_type TEXT,
      related_entity_id   TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS boardroom_project_events (
      id            SERIAL PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES boardroom_projects(id) ON DELETE CASCADE,
      event_type    TEXT NOT NULL,
      source_system TEXT NOT NULL,
      source_ref    TEXT,
      payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_boardroom_events_project_time ON boardroom_project_events (project_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_boardroom_tasks_project_status ON boardroom_tasks (project_id, status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_boardroom_risks_project_status ON boardroom_risks (project_id, status);`);

  await seedBoardroomAgents();

  logger.info('Boardroom schema initialised');
}

async function seedBoardroomAgents(): Promise<void> {
  const agents: BoardroomAgentSeed[] = [
    { id: 'hermes', agentKind: 'assistant', agentKey: 'hermes', displayName: 'Hermes', channel: '#hermes', capabilities: ['conversation', 'analysis', 'coordination'] },
    { id: 'codex', agentKind: 'external', agentKey: 'codex', displayName: 'Codex', channel: '#codex', capabilities: ['code_execution', 'analysis'] },
    { id: 'claude', agentKind: 'external', agentKey: 'claude', displayName: 'Claude', channel: '#claude', capabilities: ['code_execution', 'analysis'] },
    { id: 'kilo', agentKind: 'external', agentKey: 'kilo', displayName: 'Kilo', channel: '#kilo', capabilities: ['code_execution'] },
    { id: 'devin', agentKind: 'external', agentKey: 'devin', displayName: 'Devin', channel: '#devin', capabilities: ['code_execution'] },
    { id: 'manus', agentKind: 'external', agentKey: 'manus', displayName: 'Manus', channel: '#manus', capabilities: ['code_execution'] },
    { id: 'replit', agentKind: 'external', agentKey: 'replit', displayName: 'Replit', channel: '#replit', capabilities: ['code_execution'] },
    { id: 'viktor', agentKind: 'external', agentKey: 'viktor', displayName: 'Viktor', channel: '#viktor', capabilities: ['authority', 'delegation'] },
  ];

  for (const agent of agents) {
    await query(`
      INSERT INTO boardroom_agents (id, agent_kind, agent_key, display_name, channel, capabilities)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        agent_kind = EXCLUDED.agent_kind,
        agent_key = EXCLUDED.agent_key,
        display_name = EXCLUDED.display_name,
        channel = EXCLUDED.channel,
        capabilities = EXCLUDED.capabilities,
        updated_at = NOW()
    `, [agent.id, agent.agentKind, agent.agentKey, agent.displayName, agent.channel || null, agent.capabilities || []]);
  }
}

async function ensureProject(data: {
  repoFullName: string;
  repoName: string;
  displayName?: string;
  owner?: string;
  status?: string;
  priority?: string;
  currentPhase?: string | null;
  currentAuditAspect?: string | null;
  lastCommitSha?: string | null;
  lastActivityAt?: string | Date | null;
  healthScore?: number | null;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_projects
      (id, repo_full_name, repo_name, display_name, owner, status, priority, current_phase, current_audit_aspect, last_commit_sha, last_activity_at, health_score)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (id) DO UPDATE SET
      repo_full_name = EXCLUDED.repo_full_name,
      repo_name = EXCLUDED.repo_name,
      display_name = EXCLUDED.display_name,
      owner = COALESCE(EXCLUDED.owner, boardroom_projects.owner),
      status = COALESCE(EXCLUDED.status, boardroom_projects.status),
      priority = COALESCE(EXCLUDED.priority, boardroom_projects.priority),
      current_phase = COALESCE(EXCLUDED.current_phase, boardroom_projects.current_phase),
      current_audit_aspect = COALESCE(EXCLUDED.current_audit_aspect, boardroom_projects.current_audit_aspect),
      last_commit_sha = COALESCE(EXCLUDED.last_commit_sha, boardroom_projects.last_commit_sha),
      last_activity_at = COALESCE(EXCLUDED.last_activity_at, boardroom_projects.last_activity_at),
      health_score = COALESCE(EXCLUDED.health_score, boardroom_projects.health_score),
      updated_at = NOW()
  `, [
    data.repoFullName,
    data.repoFullName,
    data.repoName,
    data.displayName || data.repoName,
    data.owner || null,
    data.status || 'active',
    data.priority || 'medium',
    data.currentPhase || null,
    data.currentAuditAspect || null,
    data.lastCommitSha || null,
    data.lastActivityAt || null,
    data.healthScore ?? null,
  ]);
}

async function recordEvent(data: {
  projectId: string;
  eventType: BoardroomEventType;
  sourceSystem: string;
  sourceRef?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_project_events (project_id, event_type, source_system, source_ref, payload)
    VALUES ($1,$2,$3,$4,$5::jsonb)
  `, [data.projectId, data.eventType, data.sourceSystem, data.sourceRef || null, JSON.stringify(data.payload || {})]);
}

async function upsertTask(data: {
  projectId: string;
  taskType: string;
  title: string;
  description?: string | null;
  priority?: string;
  status?: string;
  source?: string;
  sourceRef?: string | null;
  safeToAutoExecute?: boolean;
  ownerAgentId?: string | null;
  executionAgentId?: string | null;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_tasks
      (project_id, task_type, title, description, priority, status, source, source_ref, safe_to_auto_execute, owner_agent_id, execution_agent_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [
    data.projectId,
    data.taskType,
    data.title,
    data.description || null,
    data.priority || 'medium',
    data.status || 'queued',
    data.source || null,
    data.sourceRef || null,
    data.safeToAutoExecute ?? false,
    data.ownerAgentId || null,
    data.executionAgentId || null,
  ]);
}

async function upsertRisk(data: {
  projectId: string;
  severity: string;
  category?: string | null;
  title: string;
  description?: string | null;
  status?: string;
  mitigation?: string | null;
  source?: string | null;
  sourceRef?: string | null;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_risks
      (project_id, severity, category, title, description, status, mitigation, source, source_ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    data.projectId,
    data.severity,
    data.category || null,
    data.title,
    data.description || null,
    data.status || 'open',
    data.mitigation || null,
    data.source || null,
    data.sourceRef || null,
  ]);
}

async function upsertDecision(data: {
  projectId: string;
  title: string;
  decision: string;
  rationale?: string | null;
  decisionType?: string;
  context?: string | null;
  decidedBy?: string | null;
  source?: string | null;
  sourceRef?: string | null;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_decisions
      (project_id, decision_type, title, context, decision, rationale, decided_by, source, source_ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    data.projectId,
    data.decisionType || 'general',
    data.title,
    data.context || null,
    data.decision,
    data.rationale || null,
    data.decidedBy || null,
    data.source || null,
    data.sourceRef || null,
  ]);
}

async function upsertKpi(data: {
  projectId: string;
  name: string;
  value: number;
  unit?: string | null;
  targetValue?: number | null;
  status?: string;
  source?: string | null;
  sourceRef?: string | null;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_kpis
      (project_id, name, value, unit, target_value, status, source, source_ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [
    data.projectId,
    data.name,
    data.value,
    data.unit || null,
    data.targetValue ?? null,
    data.status || 'tracking',
    data.source || null,
    data.sourceRef || null,
  ]);
}

async function upsertMilestone(data: {
  projectId: string;
  title: string;
  description?: string | null;
  status?: string;
  targetDate?: string | Date | null;
  progress?: number | null;
  ownerAgentId?: string | null;
  source?: string | null;
  sourceRef?: string | null;
}): Promise<void> {
  await query(
    'INSERT INTO boardroom_milestones (project_id, title, description, status, target_date, progress, owner_agent_id, source, source_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      data.projectId,
      data.title,
      data.description || null,
      data.status || 'planned',
      data.targetDate || null,
      data.progress ?? 0,
      data.ownerAgentId || null,
      data.source || null,
      data.sourceRef || null,
    ]
  );
}

async function upsertRelease(data: {
  projectId: string;
  version: string;
  status?: string;
  targetDate?: string | Date | null;
  releasedAt?: string | Date | null;
  releaseNotes?: string | null;
  linkedMilestoneId?: number | null;
}): Promise<void> {
  await query(
    'INSERT INTO boardroom_releases (project_id, version, status, target_date, released_at, release_notes, linked_milestone_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      data.projectId,
      data.version,
      data.status || 'planned',
      data.targetDate || null,
      data.releasedAt || null,
      data.releaseNotes || null,
      data.linkedMilestoneId ?? null,
    ]
  );
}

async function upsertAgentAction(data: {
  projectId: string;
  agentId: string;
  actionType: string;
  inputRef?: string | null;
  outputRef?: string | null;
  status?: string;
  taskId?: number | null;
  decisionId?: number | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
}): Promise<void> {
  await query(`
    INSERT INTO boardroom_agent_actions
      (project_id, agent_id, action_type, input_ref, output_ref, status, task_id, decision_id, started_at, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [
    data.projectId,
    data.agentId,
    data.actionType,
    data.inputRef || null,
    data.outputRef || null,
    data.status || 'recorded',
    data.taskId ?? null,
    data.decisionId ?? null,
    data.startedAt || null,
    data.completedAt || null,
  ]);
}

interface BoardroomProjectSnapshot {
  project: {
    id: string;
    repo_full_name: string;
    repo_name: string;
    display_name: string;
    status: string;
    priority: string | null;
    health_score: string | null;
    current_phase: string | null;
    current_audit_aspect: string | null;
    last_commit_sha: string | null;
    last_activity_at: string | null;
  } | null;
  milestones: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
  risks: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  kpis: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
}

async function getProjectSnapshot(repoFullName: string): Promise<BoardroomProjectSnapshot> {
  const projectResult = await query('SELECT id, repo_full_name, repo_name, display_name, status, priority, health_score, current_phase, current_audit_aspect, last_commit_sha, last_activity_at FROM boardroom_projects WHERE repo_full_name = $1 OR id = $1 LIMIT 1', [repoFullName]);
  const project = projectResult.rows[0] ?? null;
  if (!project) {
    return { project: null, milestones: [], releases: [], risks: [], decisions: [], kpis: [], tasks: [] };
  }

  const [milestones, releases, risks, decisions, kpis, tasks] = await Promise.all([
    query('SELECT id, title, description, status, target_date, progress, owner_agent_id, source, source_ref, created_at, updated_at FROM boardroom_milestones WHERE project_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 5', [project.id]),
    query('SELECT id, version, status, target_date, released_at, release_notes, linked_milestone_id, created_at, updated_at FROM boardroom_releases WHERE project_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 5', [project.id]),
    query('SELECT id, severity, category, title, description, status, mitigation, owner_agent_id, source, source_ref, detected_at, resolved_at, updated_at FROM boardroom_risks WHERE project_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 5', [project.id]),
    query('SELECT id, decision_type, title, context, decision, rationale, status, decided_by, source, source_ref, decided_at, updated_at FROM boardroom_decisions WHERE project_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 5', [project.id]),
    query('SELECT id, name, value, unit, period_start, period_end, target_value, status, source, source_ref, recorded_at, updated_at FROM boardroom_kpis WHERE project_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 5', [project.id]),
    query('SELECT id, task_type, title, description, priority, status, source, source_ref, safe_to_auto_execute, owner_agent_id, execution_agent_id, created_at, updated_at FROM boardroom_tasks WHERE project_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 5', [project.id]),
  ]);

  return { project, milestones: milestones.rows, releases: releases.rows, risks: risks.rows, decisions: decisions.rows, kpis: kpis.rows, tasks: tasks.rows };
}

async function summarizeProjectSnapshot(repoFullName: string): Promise<string> {
  const snapshot = await getProjectSnapshot(repoFullName);
  if (!snapshot.project) return 'No Boardroom project found for ' + repoFullName + '.';

  const p = snapshot.project;
  const topMilestone = snapshot.milestones[0] as any;
  const topRelease = snapshot.releases[0] as any;
  const openRisks = snapshot.risks.filter((r: any) => String(r.status ?? '').toLowerCase() !== 'resolved').slice(0, 3);
  const activeDecisions = snapshot.decisions.slice(0, 3);
  const trackingKpis = snapshot.kpis.slice(0, 3);

  return [
    'Boardroom snapshot for ' + p.display_name + ' (' + p.repo_full_name + ')',
    'Status: ' + p.status + (p.priority ? ' | priority ' + p.priority : '') + (p.current_phase ? ' | phase ' + p.current_phase : ''),
    p.health_score ? 'Health score: ' + p.health_score : null,
    p.last_commit_sha ? 'Last commit: ' + p.last_commit_sha : null,
    p.last_activity_at ? 'Last activity: ' + p.last_activity_at : null,
    topMilestone ? 'Milestone: ' + String(topMilestone.title ?? '') + ' — ' + String(topMilestone.status ?? '') + (topMilestone.progress != null ? ' (' + topMilestone.progress + '%)' : '') : 'Milestone: none yet',
    topRelease ? 'Release: ' + String(topRelease.version ?? '') + ' — ' + String(topRelease.status ?? '') : 'Release: none yet',
    openRisks.length ? 'Risks: ' + openRisks.map((r: any) => String(r.severity ?? 'medium') + ' ' + String(r.title ?? '')).join(' | ') : 'Risks: none open',
    activeDecisions.length ? 'Decisions: ' + activeDecisions.map((d: any) => String(d.title ?? '')).join(' | ') : 'Decisions: none yet',
    trackingKpis.length ? 'KPIs: ' + trackingKpis.map((k: any) => String(k.name ?? '') + '=' + String(k.value ?? '') + (k.unit ? ' ' + String(k.unit) : '')).join(' | ') : 'KPIs: none yet',
    snapshot.tasks.length ? 'Tasks: ' + snapshot.tasks.map((t: any) => String(t.task_type ?? '') + ' ' + String(t.title ?? '')).join(' | ') : 'Tasks: none yet',
  ].filter(Boolean).join('\\n');
}

export = {
  initBoardroomSchema,
  ensureProject,
  recordEvent,
  upsertTask,
  upsertRisk,
  upsertDecision,
  upsertKpi,
  upsertMilestone,
  upsertRelease,
  upsertAgentAction,
  getProjectSnapshot,
  summarizeProjectSnapshot,
};


