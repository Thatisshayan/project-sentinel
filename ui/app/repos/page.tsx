import { getPortfolio } from "@/lib/api";
import { AGENTS, healthColor } from "@/lib/data";
import { RepoRow } from "@/components/sentinel/repo-row";
import { RepoActions } from "@/components/sentinel/repo-actions";
import type { Repo } from "@/lib/types";

export const revalidate = 30;

function mapBuild(s: string | null): Repo["build"] {
  if (s === "passing" || s === "passed" || s === "pass" || s === "success") return "pass";
  if (s === "failed" || s === "fail" || s === "failure") return "fail";
  return "pending";
}
function mapPriority(s: string | null): Repo["priority"] {
  if (s === "critical") return "P0";
  if (s === "high")     return "P1";
  return "P2";
}
function relTime(iso: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function ReposPage() {
  let repos: Repo[] = [];
  let loadError = false;

  try {
    const portfolio = await getPortfolio();
    repos = portfolio.repos.map(r => ({
      name:     r.repo_name,
      health:   Math.min(100, Math.round(parseFloat(String(r.health_score ?? 0)) * 10)),
      security: Math.round(parseFloat(String(r.security_score ?? 0))),
      agent:    portfolio.agents.find(a =>
        a.repo_full_name?.endsWith(`/${r.repo_name}`) && a.status === "working"
      )?.agent_label ?? null,
      commit:   relTime(r.last_commit_at),
      build:    mapBuild(r.build_status),
      priority: mapPriority(r.priority),
      tasks:    r.tasks_queued ?? 0,
    }));
  } catch {
    // Deliberately no mock fallback — fabricated repo health/security
    // numbers are indistinguishable from real data and can paper over a
    // genuine backend outage. Show an honest empty/error state instead.
    loadError = true;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-s-border flex-shrink-0">
        <span className="text-xs text-s-muted">{repos.length} repositories</span>
        <RepoActions />
      </div>

      {loadError && (
        <div className="px-5 py-3 border-b border-s-border text-[11px] text-s-red font-mono">
          ⚠ Could not reach the portfolio API — showing no data rather than guessing. Check the backend connection and refresh.
        </div>
      )}

      <div
        className="border-b border-s-border bg-white/[0.01] flex-shrink-0"
        style={{ display:"grid", gridTemplateColumns:"16px 1fr 90px 70px 80px 26px", gap:"10px", padding:"7px 14px" }}
      >
        {["","Repository","Health","Security","Commit",""].map((h,i) => (
          <span key={i} className="text-[9px] font-bold uppercase tracking-widest text-s-dim">{h}</span>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {repos.length === 0 && !loadError && (
          <div className="px-5 py-8 text-center text-[11px] text-s-dim">No repos tracked yet.</div>
        )}
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
  );
}
