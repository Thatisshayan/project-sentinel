import { REPOS, AGENTS, healthColor } from "@/lib/data";
import { RepoRow } from "@/components/sentinel/repo-row";

export default function ReposPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-s-border">
        <span className="text-xs text-s-muted">{REPOS.length} repositories</span>
        <div className="flex gap-2">
          {["Audit All","Run Security Scan"].map(label => (
            <button key={label} className="px-3 py-1.5 text-[11px] rounded border border-s-border text-s-muted hover:text-s-text hover:border-s-border-2 transition-all">
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-3.5 py-2 border-b border-s-border bg-white/[0.01]"
        style={{ display:"grid", gridTemplateColumns:"16px 1fr 90px 70px 80px 26px", gap:"10px" }}>
        {["","Repository","Health","Security","Commit",""].map((h,i) => (
          <span key={i} className="text-[9px] font-bold uppercase tracking-widest text-s-dim">{h}</span>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {REPOS.map((repo, i) => (
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
