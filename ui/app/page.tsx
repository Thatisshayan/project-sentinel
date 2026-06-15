import { AGENTS, FEED, healthColor } from "@/lib/data";
import { getPortfolio, getAgentRoomMessages } from "@/lib/api";
import { StatStrip } from "@/components/sentinel/stat-strip";
import { RepoRow } from "@/components/sentinel/repo-row";
import { AgentFeed } from "@/components/sentinel/agent-feed";
import { BudgetPanel } from "@/components/sentinel/budget-panel";
import type { Repo, FeedEntry } from "@/lib/types";

const COL = "18px 1fr 96px 72px 76px 28px";
const GAP = "10px";

// Map agent_label → color from static config + real agent ID patterns
const AGENT_COLORS: Record<string, string> = {
  ...Object.fromEntries(AGENTS.map(a => [a.name.toLowerCase(), a.color])),
  nvidia:       "#6366F1",
  nemotron:     "#6366F1",
  hermes:       "#6366F1",
  qwen:         "#F59E0B",
  gemini:       "#22C55E",
  llama:        "#3B82F6",
  deepseek:     "#8B5CF6",
};
function agentColor(label: string) {
  const l = label?.toLowerCase() ?? '';
  for (const [key, color] of Object.entries(AGENT_COLORS)) {
    if (l.includes(key)) return color;
  }
  return "#888888";
}

export default async function OverviewPage() {
  // Fetch live data — fall back to mock if API unavailable
  let repos: Repo[] = [];
  let feed: FeedEntry[] = FEED;
  let monthlyCost = 12.40;
  let tasksQueued = 0;
  let workingCount = 0;

  try {
    const [portfolio, messages] = await Promise.all([
      getPortfolio(),
      getAgentRoomMessages(20),
    ]);

    repos = portfolio.repos.map(r => ({
      name:     r.repo_name,
      health:   Math.min(100, Math.round(parseFloat(String(r.health_score ?? 0)) * 10)),
      security: 0,
      agent:    portfolio.agents.find(a => a.repo_full_name?.endsWith(`/${r.repo_name}`) && a.status === 'working')?.agent_label ?? null,
      commit:   r.last_commit_at ? relativeTime(r.last_commit_at) : '—',
      build:    mapBuild(r.build_status),
      priority: mapPriority(r.priority),
      tasks:    r.tasks_queued ?? 0,
    }));

    feed = messages.map(m => ({
      agent: m.agent_label,
      color: agentColor(m.agent_label),
      repo:  m.repo_name ?? '',
      msg:   m.message,
      time:  relativeTime(m.created_at),
    }));

    monthlyCost = portfolio.monthlyCost;
    tasksQueued = portfolio.tasksQueued;
    workingCount = portfolio.agents.filter(a => a.status === 'working').length;
  } catch {
    // API not ready yet — fall back to mock data
    const { REPOS, AGENTS: AG, FEED: FD } = await import("@/lib/data");
    repos = REPOS;
    feed  = FD;
    tasksQueued  = repos.reduce((s, r) => s + r.tasks, 0);
    workingCount = AG.filter(a => a.status === 'working').length;
  }

  const avgHealth   = repos.length ? Math.round(repos.reduce((s, r) => s + r.health, 0) / repos.length) : 0;
  const budgetPct   = Math.round((monthlyCost / 30) * 100);

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:"1 1 0", minHeight:0, overflow:"hidden" }}>

      <StatStrip stats={[
        { label: "Avg Health",    value: avgHealth,    suffix: "",  color: avgHealth >= 80 ? "#22C55E" : avgHealth >= 60 ? "#F59E0B" : "#EF4444", sub: "+3 vs last week" },
        { label: "Active Agents", value: workingCount, suffix: "",  color: "#6366F1", sub: `${repos.length} repos` },
        { label: "Tasks Queued",  value: tasksQueued,  suffix: "",  color: "#00D4FF", sub: `across ${repos.length} repos` },
        { label: "Monthly Cost",  value: Math.round(monthlyCost * 100) / 100, suffix: "", color: "#F59E0B", sub: `$${(30 - monthlyCost).toFixed(2)} remaining` },
        { label: "Budget Used",   value: budgetPct,   suffix: "%", color: budgetPct >= 80 ? "#EF4444" : "#F59E0B", sub: `$${monthlyCost.toFixed(2)} / $30` },
      ]} />

      <div style={{ display:"flex", flex:"1 1 0", minHeight:0, overflow:"hidden" }}>

        {/* Repo list */}
        <div style={{ display:"flex", flexDirection:"column", flex:"1 1 0", minWidth:0, borderRight:"1px solid #1e1e1e", overflow:"hidden" }}>
          <div style={{ display:"grid", gridTemplateColumns:COL, gap:GAP, padding:"7px 14px", borderBottom:"1px solid #1e1e1e", background:"rgba(255,255,255,.012)", flexShrink:0 }}>
            {["","Repository","Health","Security","Commit",""].map((h, i) => (
              <span key={i} style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", color:"#444" }}>{h}</span>
            ))}
          </div>
          <div style={{ flex:"1 1 0", minHeight:0, overflowY:"auto", overflowX:"hidden" }}>
            {repos.map((repo, i) => (
              <RepoRow
                key={repo.name}
                repo={repo}
                agent={AGENTS.find(a => a.name === repo.agent) ?? null}
                index={i}
                healthColor={healthColor(repo.health)}
                secColor={healthColor(repo.security)}
              />
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display:"flex", flexDirection:"column", width:272, flexShrink:0, overflow:"hidden", borderLeft:"1px solid #1e1e1e" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 14px", borderBottom:"1px solid #1e1e1e", flexShrink:0 }}>
            <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", color:"#888" }}>Agent Activity</span>
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:"#22C55E" }}>
              <span style={{ width:5, height:5, borderRadius:"50%", background:"#22C55E", display:"inline-block" }} className="live-dot" />
              live
            </div>
          </div>
          <div style={{ flex:"1 1 0", minHeight:0, overflowY:"auto", overflowX:"hidden" }}>
            <AgentFeed entries={feed} />
          </div>
          <BudgetPanel />
        </div>
      </div>
    </div>
  );
}

function mapBuild(s: string | null): Repo['build'] {
  if (s === 'passed' || s === 'pass') return 'pass';
  if (s === 'failed' || s === 'fail') return 'fail';
  return 'pending';
}

function mapPriority(s: string | null): Repo['priority'] {
  if (s === 'critical') return 'P0';
  if (s === 'high')     return 'P1';
  return 'P2';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
