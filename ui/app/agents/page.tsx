import { getAgents } from "@/lib/api";
import { AgentsView } from "@/components/sentinel/agents-view";
import { agentColorForLabel } from "@/lib/theme";

export const revalidate = 15;

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
