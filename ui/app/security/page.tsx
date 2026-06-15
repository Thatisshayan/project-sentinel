import { REPOS, healthColor } from "@/lib/data";

const ISSUES = [
  { repo:"ml-pipeline",    title:"Prototype Pollution via lodash.merge",     cve:"CVE-2020-8203", cvss:7.4, status:"open"    },
  { repo:"ml-pipeline",    title:"ReDoS in path-to-regexp",                   cve:"CVE-2024-45296",cvss:5.3, status:"open"    },
  { repo:"data-ingestion", title:"Severity vuln in express-fileupload",       cve:"CVE-2020-7699", cvss:9.8, status:"open"    },
  { repo:"data-ingestion", title:"Deprecated: node-uuid → uuid",              cve:null,            cvss:null, status:"open"    },
  { repo:"auth-service",   title:"jwt secret exposed in git history",          cve:null,            cvss:null, status:"patched" },
  { repo:"worker-queue",   title:"SQL injection risk in raw query",            cve:null,            cvss:8.1,  status:"open"    },
  { repo:"api-gateway",    title:"Missing rate limiting on /auth/login",       cve:null,            cvss:null, status:"review"  },
];

function CvssBadge({ cvss }: { cvss: number | null }) {
  if (!cvss) return <span className="text-s-dim text-[10px] font-mono">—</span>;
  const color = cvss >= 9 ? "#EF4444" : cvss >= 7 ? "#F59E0B" : "#22C55E";
  return (
    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color, background: color + "15" }}>
      {cvss}
    </span>
  );
}

export default function SecurityPage() {
  const open = ISSUES.filter(i => i.status === "open").length;
  const critical = ISSUES.filter(i => (i.cvss ?? 0) >= 9).length;

  return (
    <div className="p-5">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label:"Avg Security", value:"72", color:"#F59E0B" },
          { label:"Open Issues",  value:String(open), color:"#EF4444" },
          { label:"Critical",     value:String(critical), color:"#EF4444" },
          { label:"Patched",      value:"1",  color:"#22C55E" },
        ].map(s => (
          <div key={s.label} className="border border-s-border rounded-lg px-3.5 py-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: s.color }} />
            <div className="text-[9px] uppercase tracking-widest text-s-dim mb-1">{s.label}</div>
            <div className="text-2xl font-extrabold font-mono" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Repo grid */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[...REPOS].sort((a,b) => a.security - b.security).map(repo => {
          const color = healthColor(repo.security);
          return (
            <div key={repo.name} className="border border-s-border rounded p-2.5 hover:bg-white/[0.02] transition-colors">
              <div className="font-mono text-[11px] font-medium truncate mb-1.5">{repo.name}</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-s-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${repo.security}%`, background: color }} />
                </div>
                <span className="text-[10px] font-mono" style={{ color }}>{repo.security}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Issues table */}
      <div className="border border-s-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-s-border bg-white/[0.01]">
          <span className="text-[10px] font-bold uppercase tracking-widest text-s-dim">Security Issues</span>
          <div className="flex gap-2">
            <button className="px-2.5 py-1 text-[10px] rounded border border-s-border text-s-muted hover:text-s-text transition-colors">Run All Scans</button>
            <button className="px-2.5 py-1 text-[10px] rounded border border-s-green/30 text-s-green hover:bg-s-green/10 transition-colors">Patch All Safe</button>
          </div>
        </div>
        <div className="grid text-[9px] font-bold uppercase tracking-widest text-s-dim px-4 py-2 border-b border-s-border bg-white/[0.005]"
          style={{ gridTemplateColumns:"140px 1fr 120px 60px 70px 80px" }}>
          {["Repo","Title","CVE","CVSS","Status",""].map(h => <span key={h}>{h}</span>)}
        </div>
        {ISSUES.map((issue, i) => (
          <div key={i}
            className="grid items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02] transition-colors"
            style={{ gridTemplateColumns:"140px 1fr 120px 60px 70px 80px" }}>
            <span className="font-mono text-[11px] text-s-muted truncate">{issue.repo}</span>
            <span className="text-xs text-s-text truncate">{issue.title}</span>
            <span className="font-mono text-[10px] text-s-ind truncate">{issue.cve ?? "—"}</span>
            <CvssBadge cvss={issue.cvss} />
            <span className={`text-[10px] font-semibold ${
              issue.status==="open" ? "text-s-red" :
              issue.status==="patched" ? "text-s-green" : "text-s-amber"
            }`}>{issue.status}</span>
            <button className="text-[10px] px-2 py-1 rounded border border-s-border text-s-muted hover:text-s-text hover:border-s-ind/40 transition-all">
              {issue.status === "open" ? "Patch" : "View"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
