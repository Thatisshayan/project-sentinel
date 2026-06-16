"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, ElementType } from "react";
import { SentinelMark } from "./logo-mark";
import {
  LayoutGrid, FolderOpen, Cpu, Shield, ListTodo,
  Terminal, Plug, Settings, PauseCircle, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { callAction } from "@/lib/actions";

function SidebarAction({
  label, icon: Icon, color, action, body, expanded,
}: {
  label: string; icon: ElementType; color: string; action: string; body?: object; expanded: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setLoading(true);
    setFailed(false);
    try { await callAction(action, body); } catch { setFailed(true); }
    setLoading(false);
  };
  return (
    <button
      onClick={run}
      disabled={loading}
      aria-label={label}
      title={failed ? `${label} failed — backend route not available` : label}
      className={cn(
        "flex items-center gap-2.5 w-full px-2 py-[6px] rounded text-[11px] font-medium transition-colors duration-100 hover:bg-white/5 disabled:opacity-50",
        failed ? "text-s-red" : color
      )}
    >
      <Icon size={13} className="flex-shrink-0 opacity-50" />
      <AnimatePresence>
        {expanded && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="whitespace-nowrap"
          >
            {loading ? "Working…" : failed ? "Failed — retry" : label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

interface SidebarStats {
  repoCount: number;
  workingCount: number;
  agentCount: number;
  securityIssueCount: number;
}

function buildNav(stats: SidebarStats | null) {
  return [
    { href: "/",           label: "Overview",   icon: LayoutGrid, badge: null,                                            badgeVariant: ""    },
    { href: "/repos",      label: "Repos",      icon: FolderOpen, badge: stats ? String(stats.repoCount) : null,          badgeVariant: "ind" },
    { href: "/agents",     label: "Agents",     icon: Cpu,        badge: stats ? `${stats.workingCount}/${stats.agentCount}` : null, badgeVariant: "ind" },
    null,
    { href: "/security",   label: "Security",   icon: Shield,     badge: stats && stats.securityIssueCount > 0 ? String(stats.securityIssueCount) : null, badgeVariant: "red" },
    { href: "/sprint",     label: "Sprints",    icon: ListTodo,   badge: null,   badgeVariant: ""        },
    { href: "/agent-room", label: "Agent Room", icon: Terminal,   badge: "LIVE", badgeVariant: "live"    },
    { href: "/connectors", label: "Connectors", icon: Plug,       badge: null,   badgeVariant: ""        },
    { href: "/settings",   label: "Settings",   icon: Settings,   badge: null,   badgeVariant: ""        },
  ];
}

const BADGE_STYLES: Record<string, string> = {
  ind:  "text-[#6366F1] bg-[#6366F1]/10",
  red:  "text-[#EF4444] bg-[#EF4444]/10",
  live: "text-[#00D4FF] bg-[#00D4FF]/10 animate-[livePulse_2s_ease-in-out_infinite]",
};

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const [stats, setStats] = useState<SidebarStats | null>(null);

  // Persist sidebar state
  useEffect(() => {
    const stored = localStorage.getItem("sentinel-sidebar");
    if (stored !== null) setExpanded(stored === "true");
  }, []);
  const toggle = () => {
    setExpanded(v => {
      localStorage.setItem("sentinel-sidebar", String(!v));
      return !v;
    });
  };

  // Live badge counts — repo count, active/total agents, open security issues
  useEffect(() => {
    const load = () => {
      fetch("/api/stats")
        .then(r => r.ok ? r.json() : null)
        .then((d: (SidebarStats & { error?: string }) | null) => { if (d && !d.error) setStats(d); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const NAV = buildNav(stats);

  return (
    <motion.nav
      animate={{ width: expanded ? 220 : 52 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative flex flex-col h-full bg-[#111111] border-r border-[#222222] overflow-hidden flex-shrink-0 z-10"
    >
      {/* Brand edge line */}
      <div className="pointer-events-none absolute right-0 top-0 w-px h-full"
        style={{ background: "linear-gradient(to bottom, transparent 0%, #C8961C 35%, #6366F1 70%, transparent 100%)", opacity: 0.25 }} />

      {/* Logo */}
      <button
        onClick={toggle}
        className="flex items-center gap-2.5 h-[52px] px-3 border-b border-[#222222] flex-shrink-0 overflow-hidden cursor-pointer w-full text-left"
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      >
        <div className="flex-shrink-0 relative">
          <SentinelMark size={28} />
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="overflow-hidden whitespace-nowrap"
            >
              <div className="font-extrabold text-[13px] leading-none tracking-tight"
                style={{ background: "linear-gradient(135deg, #F5F5F5 40%, #C8961C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                SENTINEL
              </div>
              <div className="text-[8px] text-[#444444] font-mono tracking-[0.12em] mt-[3px]">
                AUTONOMOUS · AI · OPS
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5 space-y-px">
        {NAV.map((item, i) => {
          if (item === null) {
            return <div key={`sep-${i}`} className="h-px bg-[#222222] my-2 mx-1" />;
          }
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-2.5 px-2 py-[7px] rounded min-h-[34px] text-xs font-medium transition-colors duration-100",
                active
                  ? "text-[#F5F5F5] bg-[#6366F1]/10"
                  : "text-[#888888] hover:text-[#F5F5F5] hover:bg-white/5"
              )}
            >
              {active && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute left-0 top-[22%] bottom-[22%] w-[2px] rounded-full bg-[#C8961C]"
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                />
              )}
              <Icon
                size={15}
                className={cn("flex-shrink-0 transition-colors", active ? "text-[#6366F1]" : "opacity-50 group-hover:opacity-100")}
              />
              <AnimatePresence>
                {expanded && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="flex-1 whitespace-nowrap overflow-hidden"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {expanded && item.badge && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className={cn("text-[9px] font-mono font-bold px-[5px] py-[2px] rounded-full flex-shrink-0", BADGE_STYLES[item.badgeVariant] ?? "")}
                >
                  {item.badge}
                </motion.span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 p-1.5 border-t border-[#222222] space-y-1 overflow-hidden">
        {([
          { label: "Pause All Agents", icon: PauseCircle, color: "text-[#888888]", action: "/api/system/pause", body: undefined },
          // No dedicated REST route for self-audit — route through the same
          // /api/command bridge the dashboard chat uses, which dispatches to
          // the real /sentinel self-audit handler in commands/agents.js.
          { label: "Self-Audit",        icon: ShieldCheck,  color: "text-[#C8961C]", action: "/api/command", body: { text: "/sentinel self-audit", fromName: "Dashboard" } },
        ] as const).map(({ label, icon: Icon, color, action, body }) => (
          <SidebarAction key={label} label={label} icon={Icon} color={color} action={action} body={body} expanded={expanded} />
        ))}
      </div>
    </motion.nav>
  );
}
