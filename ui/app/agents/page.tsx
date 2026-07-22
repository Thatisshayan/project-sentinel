import { getAgents } from "@/lib/api";
import { AgentsView } from "@/components/sentinel/agents-view";

export const revalidate = 15;

const AGENT_COLORS: Record<string, string> = {
  nvidia: "#6366F1", nemotron: "#6366F1", hermes: "#6366F1",
  qwen: "#F59E0B", gemini: "#22C55E", llama: "#3B82F6",
  deepseek: "#8B5CF6", aider: "#14B8A6",
};
function agentColor(label: string) {
  const l = label?.toLowerCase() ?? "";
  for (const [key, color] of Object.entries(AGENT_COLORS)) {
    if (l.includes(key)) return color;
  }
  return "#888888";
}

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
      color:          agentColor(a.agent_label),
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
