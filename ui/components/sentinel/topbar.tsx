"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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

  return (
    <header className="h-[52px] flex-shrink-0 flex items-center gap-3 px-5 bg-[#111111] border-b border-[#222222] relative overflow-hidden">
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(to right, transparent, rgba(200,150,28,.18), transparent)" }} />

      <span className="font-bold text-sm text-[#F5F5F5] tracking-tight">{meta.title}</span>
      <span className="text-[#444444] text-xs">/</span>
      <span className="text-[#888888] text-[11px] font-mono">{meta.sub}</span>

      <div className="ml-auto flex items-center gap-2.5">
        {/* Health avg */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-[#888888]">Health</span>
          {health !== null ? (
            <span className="font-bold font-mono" style={{
              color: health >= 80 ? "#22C55E" : health >= 60 ? "#F59E0B" : "#EF4444"
            }}>{health}</span>
          ) : (
            <span className="font-bold font-mono text-[#444444]">—</span>
          )}
        </div>

        <Divider />

        {/* Agent pips */}
        {working !== null && total !== null ? (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="w-[7px] h-[7px] rounded-full bg-[#22C55E]" style={{ boxShadow: "0 0 5px #22C55E90" }} />
            <span className="font-mono text-[9px] text-[#888888]">{working}/{total} active</span>
          </div>
        ) : (
          <span className="text-[9px] font-mono text-[#444444]">loading…</span>
        )}

        <Divider />

        {/* Cost */}
        <button className="flex items-center gap-1.5 px-2 py-[5px] rounded border border-[#C8961C]/25 bg-[#C8961C]/6 hover:bg-[#C8961C]/12 transition-colors">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#C8961C" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          {cost !== null ? (
            <span className="text-[11px] font-mono font-semibold text-[#C8961C]">${cost.toFixed(2)}</span>
          ) : (
            <span className="text-[11px] font-mono font-semibold text-[#444444]">$—</span>
          )}
          <span className="text-[9px] text-[#444444]">/ ${limit}</span>
          <span className="text-[8px] font-mono text-[#444444] border-l border-[#222222] pl-1.5">CostPilot</span>
        </button>

        <Divider />

        {/* Clock */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#666666]">
          <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] live-dot" />
          <LiveClock />
        </div>

        <Divider />
      </div>
    </header>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-[#222222]" />;
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
