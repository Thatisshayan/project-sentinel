import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import logger from './logger';

/**
 * Push-model bridge: Sentinel writes its own audit_tasks directly into the
 * OBSIDIAN-TEAM-BOARDROOM repo's ledger as plain Markdown + YAML frontmatter
 * (Obsidian-vault style), one file per task, mirroring ledger/tasks/_TEMPLATE.md.
 *
 * This is deliberately the opposite direction from that repo's own
 * scripts/sentinel_bridge.py, which documents itself as a boardroom-side PULL
 * with "no cross-repo writes from Sentinel". That pull bridge only mirrors
 * whole audit *reports* as one coarse ledger task each; this module covers
 * the individual audit_tasks rows the pull bridge never touches. Both write
 * into the same ledger/tasks/ directory, so next-id computation here matches
 * sentinel_bridge.py's own scheme (max existing NNN + 1) to avoid collisions
 * — a full lock isn't implemented since the two writers are not expected to
 * run at the exact same instant on this single dev machine.
 *
 * Entirely optional and silent when the boardroom repo isn't checked out
 * next to this one (e.g. the production Oracle VM container) — same
 * local-machine-only category as that repo's own boardroom-daily-sync cron.
 * Only writes files; does not commit or push (a deliberate scope cut — see
 * D-032 in docs/governance/DEFERRED_WORK.md).
 */

const TASKS_DIR_REL = path.join('ledger', 'tasks');
const POOL_FILE_REL = path.join('ledger', 'pool.md');
const MAP_FILE_REL = path.join('ledger', '.sentinel-task-map.json');

interface LedgerTaskMapEntry {
  ledgerNumber: number;
  fileName: string;
  repoFullName: string;
}
type LedgerTaskMap = Record<string, LedgerTaskMapEntry>;

export interface CreateLedgerTaskParams {
  postgresTaskId: number;
  repoFullName: string;
  title: string;
  description?: string | null;
  priority: string;
  category?: string | null;
  affectedFiles?: string[] | null;
  acceptanceCriteria?: string | null;
  safetyReason?: string | null;
  builderAgent?: string | null;
  status: string;
}

export interface UpdateLedgerTaskExtra {
  prUrl?: string | null;
  commitUrl?: string | null;
  failureReason?: string;
}

function resolveBoardroomPath(): string {
  const override = process.env['OBSIDIAN_BOARDROOM_PATH'];
  if (override) return override;
  // project-sentinel and OBSIDIAN-TEAM-BOARDROOM are sibling checkouts under
  // the same parent directory (matches sentinel_bridge.py's own
  // BOARDROOT.parent / "project-sentinel" assumption).
  return path.resolve(__dirname, '..', '..', '..', 'OBSIDIAN-TEAM-BOARDROOM');
}

function isAvailable(boardroomPath: string): boolean {
  return existsSync(path.join(boardroomPath, TASKS_DIR_REL));
}

function readMap(boardroomPath: string): LedgerTaskMap {
  const mapPath = path.join(boardroomPath, MAP_FILE_REL);
  if (!existsSync(mapPath)) return {};
  try {
    return JSON.parse(readFileSync(mapPath, 'utf8')) as LedgerTaskMap;
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'obsidianLedgerWriter: could not parse task map, starting fresh');
    return {};
  }
}

function writeMap(boardroomPath: string, map: LedgerTaskMap): void {
  writeFileSync(path.join(boardroomPath, MAP_FILE_REL), JSON.stringify(map, null, 2) + '\n', 'utf8');
}

function nextLedgerNumber(boardroomPath: string): number {
  const tasksDir = path.join(boardroomPath, TASKS_DIR_REL);
  let hi = 0;
  for (const fn of readdirSync(tasksDir)) {
    const m = /^(\d{3})-.*\.md$/.exec(fn);
    if (m) hi = Math.max(hi, parseInt(m[1]!, 10));
  }
  return hi + 1;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

/**
 * Sentinel's audit_tasks.status vocabulary -> the ledger's allowed status
 * set (see OBSIDIAN-TEAM-BOARDROOM/scripts/verify_ledger.py ALLOWED_STATUS).
 * 'queued' is NOT in that allowed set, so it must map to 'proposed'.
 */
function mapStatus(sentinelStatus: string): string {
  switch (sentinelStatus) {
    case 'queued':       return 'proposed';
    case 'in_progress':  return 'in_progress';
    case 'build_check':  return 'review';
    case 'done':         return 'done';
    case 'skipped':      return 'cancelled';
    case 'failed':       return 'blocked';
    default:             return 'proposed';
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderTaskFile(params: CreateLedgerTaskParams, ledgerId: string, created: string): string {
  const criteria = (params.acceptanceCriteria || '').trim();
  const criteriaLines = criteria
    ? criteria.split(/\r?\n/).filter(Boolean).map((l) => `- [ ] ${l.replace(/^[-*]\s*/, '')}`)
    : ['- [ ] (none specified by Sentinel)'];
  const files = (params.affectedFiles && params.affectedFiles.length > 0)
    ? params.affectedFiles.map((f) => `- ${f}`)
    : ['- (none listed)'];

  return [
    '---',
    `id: ${ledgerId}`,
    `title: "[Sentinel] ${params.title.replace(/"/g, "'")} (${params.repoFullName})"`,
    `status: ${mapStatus(params.status)}`,
    'owner: unassigned',
    'branch: ""',
    `priority: ${params.priority || 'medium'}`,
    `created: ${created}`,
    `updated: ${created}`,
    'traces-to: "audit-engine:sentinel"',
    '---',
    '',
    '## Description',
    params.description?.trim() || '(no description provided)',
    params.category ? `\nCategory: ${params.category}` : '',
    params.safetyReason ? `\nSafety note: ${params.safetyReason}` : '',
    '',
    '## Acceptance Criteria',
    ...criteriaLines,
    '',
    '## Technical Notes',
    `Auto-created by Sentinel's obsidianLedgerWriter.ts from audit_tasks row #${params.postgresTaskId}` +
      ` (repo: ${params.repoFullName}, builder: ${params.builderAgent || 'nvidia'}).`,
    'This file mirrors Sentinel\'s own Postgres record; status/notes edited here are',
    'not synced back — use Sentinel\'s own commands to change task state.',
    '',
    '## Risk Level',
    params.priority || 'medium',
    '',
    '## Related Files',
    ...files,
    '',
    '## Progress Log',
    `- ${created}: created by Sentinel (audit_tasks#${params.postgresTaskId}), status ${mapStatus(params.status)}.`,
    '',
  ].join('\n');
}

function appendPoolRow(boardroomPath: string, ledgerNumber: number, title: string, priority: string, status: string): void {
  const poolPath = path.join(boardroomPath, POOL_FILE_REL);
  if (!existsSync(poolPath)) return;
  const content = readFileSync(poolPath, 'utf8');
  const idStr = String(ledgerNumber).padStart(3, '0');
  const row = `| ${idStr} | ${title.replace(/\|/g, '/')} | ${priority || 'medium'} | ${status} | unassigned |`;
  // Insert right after the header separator row (the "|----|...|" line),
  // so new entries land at the top of the open-task table.
  const lines = content.split(/\r?\n/);
  const sepIdx = lines.findIndex((l) => /^\|[-\s|]+\|$/.test(l));
  if (sepIdx === -1) {
    // Table not found in the expected shape — append at end rather than fail silently.
    writeFileSync(poolPath, content.replace(/\n$/, '') + `\n${row}\n`, 'utf8');
    return;
  }
  lines.splice(sepIdx + 1, 0, row);
  writeFileSync(poolPath, lines.join('\n'), 'utf8');
}

function updatePoolRow(boardroomPath: string, ledgerNumber: number, status: string): void {
  const poolPath = path.join(boardroomPath, POOL_FILE_REL);
  if (!existsSync(poolPath)) return;
  const content = readFileSync(poolPath, 'utf8');
  const idStr = String(ledgerNumber).padStart(3, '0');
  const rowRe = new RegExp(`^\\|\\s*${idStr}\\s*\\|(.*)\\|(.*)\\|(.*)\\|(.*)\\|$`);

  // Line-based (not a whole-content regex replace) so removing a row can
  // drop its line cleanly — a regex .replace(rowRe, '') would leave a blank
  // line in the row's place, which breaks Markdown table rendering for
  // every row that follows it.
  const lines = content.split(/\r?\n/);
  const rowIdx = lines.findIndex((l) => rowRe.test(l));
  if (rowIdx === -1) return; // row already removed (e.g. previously marked done) — nothing to update

  if (status === 'done') {
    lines.splice(rowIdx, 1);
    const doneLineIdx = lines.findIndex((l) => /^DONE:/.test(l));
    if (doneLineIdx !== -1) {
      lines[doneLineIdx] = lines[doneLineIdx]!.replace(/^DONE:\s*/, `DONE: ${idStr}, `);
    } else {
      lines.push(`DONE: ${idStr}`);
    }
    writeFileSync(poolPath, lines.join('\n'), 'utf8');
    return;
  }

  const match = rowRe.exec(lines[rowIdx]!)!;
  lines[rowIdx] = `| ${idStr} |${match[1]}| ${match[2]!.trim() || 'medium'} | ${status} |${match[4]}|`;
  writeFileSync(poolPath, lines.join('\n'), 'utf8');
}

function appendProgressLog(content: string, line: string): string {
  const idx = content.indexOf('## Progress Log');
  if (idx === -1) return content + `\n## Progress Log\n${line}\n`;
  const before = content.slice(0, idx);
  const after = content.slice(idx);
  const headingEnd = after.indexOf('\n') + 1;
  return before + after.slice(0, headingEnd) + `${line}\n` + after.slice(headingEnd);
}

export async function createLedgerTask(params: CreateLedgerTaskParams): Promise<void> {
  try {
    const boardroomPath = resolveBoardroomPath();
    if (!isAvailable(boardroomPath)) return;

    mkdirSync(path.join(boardroomPath, TASKS_DIR_REL), { recursive: true });
    let ledgerNumber = nextLedgerNumber(boardroomPath);
    let fileName = `${String(ledgerNumber).padStart(3, '0')}-${slugify(`${params.repoFullName}-${params.title}`)}.md`;
    let filePath = path.join(boardroomPath, TASKS_DIR_REL, fileName);
    // Defense-in-depth against a rare race with sentinel_bridge.py picking
    // the same next id between our scan and our write.
    while (existsSync(filePath)) {
      ledgerNumber += 1;
      fileName = `${String(ledgerNumber).padStart(3, '0')}-${slugify(`${params.repoFullName}-${params.title}`)}.md`;
      filePath = path.join(boardroomPath, TASKS_DIR_REL, fileName);
    }

    const created = todayIso();
    const ledgerId = `TASK-${String(ledgerNumber).padStart(3, '0')}`;
    writeFileSync(filePath, renderTaskFile(params, ledgerId, created), 'utf8');
    appendPoolRow(boardroomPath, ledgerNumber, `[Sentinel] ${params.title} (${params.repoFullName})`, params.priority, mapStatus(params.status));

    const map = readMap(boardroomPath);
    map[String(params.postgresTaskId)] = { ledgerNumber, fileName, repoFullName: params.repoFullName };
    writeMap(boardroomPath, map);

    logger.info({ postgresTaskId: params.postgresTaskId, ledgerId, fileName }, 'obsidianLedgerWriter: ledger task created');
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), postgresTaskId: params.postgresTaskId },
      'obsidianLedgerWriter: could not create ledger task — non-blocking');
  }
}

export async function updateLedgerTaskStatus(postgresTaskId: number | null, status: string, extra: UpdateLedgerTaskExtra = {}): Promise<void> {
  if (!postgresTaskId) return;
  try {
    const boardroomPath = resolveBoardroomPath();
    if (!isAvailable(boardroomPath)) return;

    const map = readMap(boardroomPath);
    const entry = map[String(postgresTaskId)];
    if (!entry) return; // task was never mirrored (created before this feature, or boardroom unavailable at create time)

    const filePath = path.join(boardroomPath, TASKS_DIR_REL, entry.fileName);
    if (!existsSync(filePath)) return;

    const ledgerStatus = mapStatus(status);
    const updated = todayIso();
    let content = readFileSync(filePath, 'utf8');
    content = content.replace(/^status:.*$/m, `status: ${ledgerStatus}`);
    content = content.replace(/^updated:.*$/m, `updated: ${updated}`);

    const extraNotes: string[] = [];
    if (extra.prUrl) extraNotes.push(`PR: ${extra.prUrl}`);
    if (extra.commitUrl) extraNotes.push(`Commit: ${extra.commitUrl}`);
    if (extra.failureReason) extraNotes.push(`Reason: ${extra.failureReason.slice(0, 300)}`);
    const suffix = extraNotes.length > 0 ? ` (${extraNotes.join(', ')})` : '';
    content = appendProgressLog(content, `- ${updated}: status -> ${ledgerStatus}${suffix}.`);
    writeFileSync(filePath, content, 'utf8');

    updatePoolRow(boardroomPath, entry.ledgerNumber, ledgerStatus);

    logger.debug({ postgresTaskId, ledgerStatus }, 'obsidianLedgerWriter: ledger task status updated');
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), postgresTaskId },
      'obsidianLedgerWriter: could not update ledger task — non-blocking');
  }
}
