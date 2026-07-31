import { getCurrentSprint } from "@/lib/api";
import { SprintView } from "@/components/sentinel/sprint-view";
import { mapTaskStatus } from "@/lib/format";

export const revalidate = 60;

export default async function SprintPage() {
  let data = null;
  let fetchFailed = false;
  try {
    data = await getCurrentSprint();
  } catch {
    fetchFailed = true;
  }

  // Deliberately no mock fallback — a fabricated "Sprint 24" with fake
  // tasks/velocity is indistinguishable from a real sprint and can paper
  // over a genuine backend outage. Render whatever's real (possibly empty)
  // and let SprintView show an honest empty/error state instead.
  const sprint  = data?.sprint ?? null;
  const tasks   = data?.tasks  ?? [];
  const velocity = (data?.velocity ?? []).map(v => ({ value: v.tasks_completed, label: weekLabel(v.week_start) }));

  const done    = tasks.filter(t => t.status === 'done' || t.status === 'completed').length;
  const total   = tasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const displaySprint = sprint
    ? {
        name:     `Sprint ${sprint.id} — ${sprint.proposal_summary?.slice(0, 30) || 'Active Sprint'}`,
        start:    fmtDate(sprint.week_start),
        end:      fmtDate(sprint.week_end),
        progress,
        id:       sprint.id,
        status:   sprint.status,
      }
    : null;

  const displayTasks = tasks.map(t => ({
    title:    'task_title' in t ? (t as any).task_title : (t as any).title,
    agent:    'builder_agent' in t ? (t as any).builder_agent : (t as any).agent,
    status:   mapTaskStatus((t as any).status),
    priority: ((t as any).priority ?? 'P2').toUpperCase(),
    id:       (t as any).id,
  }));

  return (
    <SprintView
      sprint={displaySprint}
      tasks={displayTasks}
      velocity={velocity}
      loadError={fetchFailed}
    />
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function weekLabel(iso: string) {
  const d = new Date(iso);
  const start = new Date('2026-01-05');
  const week  = Math.floor((d.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
  return `W${week}`;
}
