import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardroomSnapshot } from './boardroomSnapshot';

const ARTIFACT_PATH = join(process.cwd(), 'audits', 'private', 'boardroom-snapshot.md');

export function writeBoardroomSnapshotArtifact(snapshot: BoardroomSnapshot): string {
  mkdirSync(join(process.cwd(), 'audits', 'private'), { recursive: true });
  const lines = [
    '---',
    'title: Boardroom Snapshot',
    `updated_at: ${snapshot.updatedAt}`,
    `health: ${snapshot.health}`,
    `board_decision: ${snapshot.boardDecision}`,
    'source: project-sentinel',
    '---',
    '',
    '# Boardroom Snapshot',
    '',
    `Updated: ${snapshot.updatedAt}`,
    `Decision: ${snapshot.boardDecision}`,
    `Summary: ${snapshot.summary}`,
    '',
    '## KPIs',
    ...snapshot.kpis.map(([label, value]) => `- ${label}: ${value}`),
    '',
    '## Projects',
    ...snapshot.projects.map((project) => `- ${project.name} | ${project.sub} | ${project.status.join(' · ')}`),
    '',
    '## Risks',
    ...snapshot.risks.map(([id, title, severity]) => `- ${id} ${title} (${severity})`),
    '',
    '## Milestones',
    ...snapshot.milestones.map(([name, status, detail]) => `- ${name}: ${status} — ${detail}`),
    '',
    '## Ledger Sample',
    ...snapshot.ledger.map(([id, title, owner, status, trace, updated]) => `- ${id} | ${title} | ${owner} | ${status} | ${trace} | ${updated}`),
    '',
    '## Runtime',
    `- Branch: ${snapshot.state.branch}`,
    `- Upstream: ${snapshot.state.upstream}`,
    `- Dirty tree: ${snapshot.state.dirtyTree}`,
    `- Build: ${snapshot.state.build}`,
    `- Test: ${snapshot.state.test}`,
    `- Scripts: ${snapshot.state.scripts}`,
    `- Queue depth: ${snapshot.state.queueDepth}`,
    `- Active agents: ${snapshot.state.agentsActive}`,
    `- Event rate: ${snapshot.state.eventRate}`,
    `- Uptime: ${snapshot.state.uptime}`,
    '',
    '## Actions',
    ...snapshot.actions.map(([agent, action, time]) => `- ${agent}: ${action} (${time})`),
    '',
  ].join('\n');

  writeFileSync(ARTIFACT_PATH, lines, 'utf8');
  return ARTIFACT_PATH;
}
