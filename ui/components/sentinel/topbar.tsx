"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { scoreColor } from "@/lib/theme";

const PAGE_META: Record<string, { title: string; sub: string }> = {
  "/":           { title: "Overview",     sub: "Portfolio"       },
  "/repos":      { title: "Repositories", sub: "Repos"           },
  "/agents":     { title: "Agents",       sub: "Agents"          },
  "/agent-room": { title: "Agent Room",   sub: "Live terminal"   },
  "/security":   { title: "Security",     sub: "Portfolio scan"  },
  "/sprint":     { title: "Sprints",      sub: "Current sprint"  },
  "/connectors": { title: "Connectors",   sub: "Integrations"    },
  "/settings":   { title: "Settings",     sub: "Configuration"   },
};

interface Stats {
  avgHealth: number;
  workingCount: number;
  agentCount: number;
  monthlyCost: number;
  budgetLimit: number;
  governanceStatus: "healthy" | "drift" | "unconfigured";
  governanceDriftCount: number;
}

export function Topbar() {
  const pathname = usePathname();
  const meta = PAGE_META[pathname] ?? { title: pathname.slice(1), sub: "" };
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.ok ? r.json() : null)
      .then((d: Stats | null) => { if (d && !("error" in d)) setStats(d); })
      .catch(() => {});
    const id = setInterval(() => {
      fetch("/api/stats")
        .then(r => r.ok ? r.json() : null)
        .then((d: Stats | null) => { if (d && !("error" in d)) setStats(d); })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const health = stats?.avgHealth ?? null;
  const working = stats?.workingCount ?? null;
  const total   = stats?.agentCount ?? null;
  const cost    = stats?.monthlyCost ?? null;
  const limit   = stats?.budgetLimit ?? 30;
  const governanceStatus = stats?.governanceStatus ?? "unconfigured";
  const governanceDriftCount = stats?.governanceDriftCount ?? 0;
  const governanceColor =
    governanceStatus === "healthy" ? "#22C55E" :
    governanceStatus === "drift" ? "#EF4444" :
    "#F59E0B";
  const governanceLabel =
    governanceStatus === "healthy" ? "Governed" :
    governanceStatus === "drift" ? `${governanceDriftCount} drift` :
    "Unchecked";

  return (
    <header className="h-[52px] flex-shrink-0 flex items-center gap-3 px-5 bg-s-surface border-b border-s-border relative overflow-hidden">
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(to right, transparent, rgba(200,150,28,.18), transparent)" }} />

      <span className="font-bold text-sm text-s-text tracking-tight">{meta.title}</span>
      <span className="text-s-dim text-xs">/</span>
      <span className="text-s-muted text-[11px] font-mono">{meta.sub}</span>

      <div className="ml-auto flex items-center gap-2.5">
        {/* Health avg */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-s-muted">Health</span>
          {health !== null ? (
            <span className="font-bold font-mono" style={{ color: scoreColor(health) }}>{health}</span>
          ) : (
            <span className="font-bold font-mono text-s-dim">—</span>
          )}
        </div>

        <Divider />

        {/* Agent pips */}
        {working !== null && total !== null ? (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="w-[7px] h-[7px] rounded-full bg-s-green" style={{ boxShadow: "0 0 5px #22C55E90" }} />
            <span className="font-mono text-[9px] text-s-muted">{working}/{total} active</span>
          </div>
        ) : (
          <span className="text-[9px] font-mono text-s-dim">loading…</span>
        )}

        <Divider />

        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-s-muted">Governance</span>
          <span className="font-mono font-bold" style={{ color: governanceColor }}>{governanceLabel}</span>
        </div>

        <Divider />

        {/* Cost */}
        <button className="flex items-center gap-1.5 px-2 py-[5px] rounded border border-s-gold/25 bg-s-gold/[0.06] hover:bg-s-gold/[0.12] transition-colors">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#C8961C" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          {cost !== null ? (
            <span className="text-[11px] font-mono font-semibold text-s-gold">${cost.toFixed(2)}</span>
          ) : (
            <span className="text-[11px] font-mono font-semibold text-s-dim">$—</span>
          )}
          <span className="text-[9px] text-s-dim">/ ${limit}</span>
          <span className="text-[8px] font-mono text-s-dim border-l border-s-border pl-1.5">CostPilot</span>
        </button>

        <Divider />

        {/* Clock */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#666666]">
          <span className="w-[6px] h-[6px] rounded-full bg-s-green live-dot" />
          <LiveClock />
        </div>

        <Divider />
      </div>
    </header>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-s-border" />;
}

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);
  return <span>{time}</span>;
}
