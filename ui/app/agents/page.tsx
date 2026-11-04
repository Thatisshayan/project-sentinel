import { getAgents } from "@/lib/api";
import { AgentsView } from "@/components/sentinel/agents-view";
import { agentColorForLabel } from "@/lib/theme";

// Render on every request. The Docker build has no backend URL, so without
// this Next prerenders the page once at build time and every visitor gets
// that saved "could not reach the API" page. Checked by
// scripts/check-prerendered.mjs after every build.
export const dynamic = "force-dynamic";

// No `export const revalidate` here: lib/api.ts's api() helper fetches with
// cache: 'no-store' so agent-toggle mutations show up immediately on
// router.refresh() — a revalidate window on this segment would be dead
// config, since the underlying fetch already opts the route out of caching.

export default async function AgentsPage() {
  let agents: {
    id: string; label: string; color: string; status: string;
    repo: string | null; task: string | null;
    completedTasks: number; failedTasks: number;
  }[] = [];
  let loadError = false;

  try {
    const raw = await getAgents();
    agents = raw.map(a => ({
      id:             a.agent_id,
      label:          a.agent_label,
      color:          agentColorForLabel(a.agent_label),
      status:         a.status,
      repo:           a.repo_full_name?.split("/").pop() ?? null,
      task:           a.task_title,
      completedTasks: a.completed_tasks,
      failedTasks:    a.failed_tasks,
    }));
  } catch {
    // Deliberately no mock fallback — fabricated agent statuses are
    // indistinguishable from real data and can paper over a genuine
    // backend outage. Show an honest empty/error state instead.
    loadError = true;
  }

  return <AgentsView agents={agents} loadError={loadError} />;
}
