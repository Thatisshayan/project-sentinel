import { getCurrentSprint } from "@/lib/api";
import { AGENTS } from "@/lib/data";
import { SprintView } from "@/components/sentinel/sprint-view";

export const revalidate = 60;

export default async function SprintPage() {
  let data = null;
  try {
    data = await getCurrentSprint();
  } catch {}

  // Build display data — fallback to mock if no API data yet
  const sprint = data?.sprint ?? null;
  const tasks  = data?.tasks  ?? MOCK_TASKS;
  const velocity = (data?.velocity ?? []).length > 0
    ? data!.velocity.map(v => ({ value: v.tasks_completed, label: weekLabel(v.week_start) }))
    : MOCK_VELOCITY;

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
    : MOCK_SPRINT;

  const displayTasks = tasks.map(t => ({
    title:    'task_title' in t ? (t as any).task_title : (t as any).title,
    agent:    'builder_agent' in t ? (t as any).builder_agent : (t as any).agent,
    status:   mapStatus((t as any).status),
    priority: ((t as any).priority ?? 'P2').toUpperCase(),
    id:       (t as any).id,
  }));

  return <SprintView sprint={displaySprint} tasks={displayTasks} velocity={velocity} />;
}

function mapStatus(s: string): 'done' | 'working' | 'blocked' | 'todo' {
  if (s === 'completed' || s === 'done') return 'done';
  if (s === 'in_progress' || s === 'working') return 'working';
  if (s === 'failed' || s === 'blocked') return 'blocked';
  return 'todo';
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

// ── Fallback mock data ────────────────────────────────────────────────────────

const MOCK_SPRINT = { name:"Sprint 24 — Core Hardening", start:"Jun 9", end:"Jun 22", progress:68, id:0, status:'approved' };

const MOCK_TASKS = [
  { title:"Refactor auth middleware → JWT RS256",      agent:"Nemotron",   status:"done",    priority:"P0", id:1 },
  { title:"Add pagination to /users endpoint",         agent:"Qwen Coder", status:"working", priority:"P1", id:2 },
  { title:"Fix CORS headers on OPTIONS preflight",     agent:"Llama",      status:"working", priority:"P1", id:3 },
  { title:"CVE scan: lodash, express-validator",       agent:"Qwen Turbo", status:"working", priority:"P0", id:4 },
  { title:"Optimize N+1 queries in /reports",          agent:"DeepSeek",   status:"blocked", priority:"P1", id:5 },
  { title:"Add OpenTelemetry tracing to api-gateway",  agent:null,          status:"todo",    priority:"P2", id:6 },
  { title:"Write E2E tests for auth flow",             agent:null,          status:"todo",    priority:"P1", id:7 },
  { title:"Update OpenAPI spec v2.1",                  agent:"Llama",      status:"done",    priority:"P2", id:8 },
];

const MOCK_VELOCITY = [
  { value:18, label:"W17" },{ value:22, label:"W18" },{ value:15, label:"W19" },
  { value:28, label:"W20" },{ value:31, label:"W21" },{ value:24, label:"W22" },
  { value:27, label:"W23" },{ value:19, label:"W24" },
];
