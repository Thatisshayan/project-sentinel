import { getPortfolio, getAgentRoomMessages, getGovernanceStatus } from "@/lib/api";
import { scoreColor, agentColorForLabel } from "@/lib/theme";
import { mapBuild, mapPriority, relativeTime } from "@/lib/format";
import { StatStrip } from "@/components/sentinel/stat-strip";
import { RepoRow } from "@/components/sentinel/repo-row";
import { AgentFeed } from "@/components/sentinel/agent-feed";
import { BudgetPanel } from "@/components/sentinel/budget-panel";
import type { Repo, FeedEntry } from "@/lib/types";

const COL = "18px 1fr 96px 72px 76px 28px";

export default async function OverviewPage() {
  let repos: Repo[] = [];
  let feed: FeedEntry[] = [];
  let monthlyCost = 0;
  let tasksQueued = 0;
  let workingCount = 0;
  let healthDelta: number | null = null;
  let governanceDriftCount = 0;

  try {
    const [portfolio, messages, governance] = await Promise.all([
      getPortfolio(),
      getAgentRoomMessages(20),
      getGovernanceStatus(),
    ]);

    repos = portfolio.repos.map(r => {
      const workingAgent = portfolio.agents.find(
        a => a.repo_full_name?.endsWith(`/${r.repo_name}`) && a.status === 'working'
      );
      return {
        name:     r.repo_name,
        health:   Math.min(100, Math.round(parseFloat(String(r.health_score ?? 0)) * 10)),
        security: Math.round(parseFloat(String(r.security_score ?? 0))),
        agent:    workingAgent?.agent_label ?? null,
        commit:   relativeTime(r.last_commit_at),
        build:    mapBuild(r.build_status),
        priority: mapPriority(r.priority),
        tasks:    r.tasks_queued ?? 0,
      };
    });

    feed = messages.map(m => ({
      agent: m.agent_label,
      color: agentColorForLabel(m.agent_label),
      repo:  m.repo_name ?? '',
      msg:   m.message,
      time:  relativeTime(m.created_at),
    }));

    monthlyCost = portfolio.monthlyCost;
    tasksQueued = portfolio.tasksQueued;
    healthDelta = portfolio.healthDelta ?? null;
    workingCount = portfolio.agents.filter(a => a.status === 'working').length;
    governanceDriftCount = governance.drift.length;
  } catch {
    // API unavailable — show empty state, don't show fake data
  }

  const avgHealth   = repos.length ? Math.round(repos.reduce((s, r) => s + r.health, 0) / repos.length) : 0;
  const budgetPct   = Math.round((monthlyCost / 30) * 100);
  const healthDeltaSub = healthDelta != null
    ? `${healthDelta >= 0 ? '+' : ''}${healthDelta.toFixed(1)} vs last week`
    : 'no prior week data';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      <StatStrip stats={[
        { label: "Avg Health",    value: avgHealth,    suffix: "",  color: scoreColor(avgHealth), sub: healthDeltaSub },
        { label: "Active Agents", value: workingCount, suffix: "",  color: "#6366F1", sub: `${repos.length} repos` },
        { label: "Tasks Queued",  value: tasksQueued,  suffix: "",  color: "#00D4FF", sub: `across ${repos.length} repos` },
        { label: "Governance",   value: governanceDriftCount, suffix: "", color: governanceDriftCount === 0 ? "#22C55E" : "#EF4444", sub: governanceDriftCount === 0 ? "branch policy aligned" : "control-plane drift items" },
        { label: "Monthly Cost",  value: Math.round(monthlyCost * 100) / 100, suffix: "", color: "#F59E0B", sub: `$${(30 - monthlyCost).toFixed(2)} remaining` },
        { label: "Budget Used",   value: budgetPct,   suffix: "%", color: budgetPct >= 80 ? "#EF4444" : "#F59E0B", sub: `$${monthlyCost.toFixed(2)} / $30` },
      ]} />

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Repo list */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-[#1e1e1e] overflow-hidden">
          <div
            className="border-b border-[#1e1e1e] bg-white/[0.012] flex-shrink-0"
            style={{ display: "grid", gridTemplateColumns: COL, gap: "10px", padding: "7px 14px" }}
          >
            {["", "Repository", "Health", "Security", "Commit", ""].map((h, i) => (
              <span key={i} className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#444]">{h}</span>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {repos.map((repo, i) => {
              const agentObj = repo.agent ? {
                id: repo.agent, name: repo.agent, model: "", provider: "",
                color: agentColorForLabel(repo.agent), status: "working" as const,
                task: null, repo: repo.name, elapsed: 0, done: 0, prs: 0, fails: 0,
              } : null;
              return (
                <RepoRow
                  key={repo.name}
                  repo={repo}
                  agent={agentObj}
                  index={i}
                  healthColor={scoreColor(repo.health)}
                  secColor={scoreColor(repo.security)}
                />
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col w-[272px] flex-shrink-0 overflow-hidden border-l border-[#1e1e1e]">
          <div className="flex items-center justify-between px-3.5 py-[7px] border-b border-[#1e1e1e] flex-shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-s-muted">Agent Activity</span>
            <div className="flex items-center gap-1.5 text-[10px] text-s-green">
              <span className="w-[5px] h-[5px] rounded-full bg-s-green inline-block live-dot" />
              live
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <AgentFeed entries={feed} />
          </div>
          <BudgetPanel />
        </div>
      </div>
    </div>
  );
}
