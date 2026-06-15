"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AGENTS } from "@/lib/data";
import { Search } from "lucide-react";

const PAGE_META: Record<string, { title: string; sub: string }> = {
  "/":           { title: "Overview",     sub: "Portfolio"       },
  "/repos":      { title: "Repositories", sub: "12 repos"        },
  "/agents":     { title: "Agents",       sub: "8 agents"        },
  "/agent-room": { title: "Agent Room",   sub: "Live terminal"   },
  "/security":   { title: "Security",     sub: "Portfolio scan"  },
  "/sprint":     { title: "Sprints",      sub: "Week 24"         },
  "/connectors": { title: "Connectors",   sub: "Integrations"    },
  "/settings":   { title: "Settings",     sub: "Configuration"   },
};

export function Topbar() {
  const pathname = usePathname();
  const meta = PAGE_META[pathname] ?? { title: pathname.slice(1), sub: "" };
  const working = AGENTS.filter(a => a.status === "working").length;

  return (
    <header className="h-[52px] flex-shrink-0 flex items-center gap-3 px-5 bg-[#111111] border-b border-[#222222] relative overflow-hidden">
      {/* Shimmer line */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(to right, transparent, rgba(200,150,28,.18), transparent)" }} />

      {/* Page title */}
      <span className="font-bold text-sm text-[#F5F5F5] tracking-tight">{meta.title}</span>
      <span className="text-[#444444] text-xs">/</span>
      <span className="text-[#888888] text-[11px] font-mono">{meta.sub}</span>

      <div className="ml-auto flex items-center gap-2.5">
        {/* Health avg */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-[#888888]">Health</span>
          <span className="font-bold font-mono text-[#F59E0B]">74</span>
        </div>

        <Divider />

        {/* Agent pips */}
        <div className="flex items-center gap-[5px]" title={`${working} working · ${8 - working} idle`}>
          {AGENTS.map(a => (
            <span
              key={a.id}
              title={`${a.name} · ${a.status}`}
              className="w-[7px] h-[7px] rounded-full flex-shrink-0"
              style={{
                background: a.status === "idle" ? "#333" : a.color,
                boxShadow: a.status === "working" ? `0 0 5px ${a.color}90` : undefined,
              }}
            />
          ))}
          <span className="text-[9px] font-mono text-[#888888] ml-0.5">{working} active</span>
        </div>

        <Divider />

        {/* CostPilot */}
        <button className="flex items-center gap-1.5 px-2 py-[5px] rounded border border-[#C8961C]/25 bg-[#C8961C]/6 hover:bg-[#C8961C]/12 transition-colors group">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#C8961C" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <CostTicker />
          <span className="text-[9px] text-[#444444]">/ $30</span>
          <span className="text-[8px] font-mono text-[#444444] border-l border-[#222222] pl-1.5">CostPilot</span>
        </button>

        <Divider />

        {/* Clock */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#666666]">
          <span className="w-[6px] h-[6px] rounded-full bg-[#22C55E] live-dot" />
          <LiveClock />
        </div>

        <Divider />

        {/* ⌘K */}
        <button className="flex items-center gap-1.5 px-2 py-[5px] rounded border border-[#2e2e2e] bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-[#888888] text-[10px]"
          aria-label="Open command palette (⌘K / Ctrl+K)">
          <Search size={10} />
          <span className="font-mono">⌘K</span>
        </button>
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

function CostTicker() {
  const [cost, setCost] = useState(12.40);
  useEffect(() => {
    const id = setInterval(() => setCost(c => parseFloat((c + Math.random() * 0.003).toFixed(2))), 4000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-[11px] font-mono font-semibold text-[#C8961C]">${cost.toFixed(2)}</span>;
}
