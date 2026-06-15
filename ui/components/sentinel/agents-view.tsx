"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions";

interface Agent {
  id: string; label: string; color: string; status: string;
  repo: string | null; task: string | null;
  completedTasks: number; failedTasks: number;
}

const STATUS_COLOR: Record<string, string> = {
  working: "text-s-green", idle: "text-s-muted",
  failed: "text-s-red",    paused: "text-s-amber",
};

function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isOn = agent.status === "working";

  const toggle = async () => {
    setLoading(true);
    try {
      await callAction(`/api/agents/${agent.id}/toggle`);
      router.refresh();
    } catch {}
    setLoading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className="border border-s-border rounded-lg p-4 hover:border-s-border-2 transition-colors relative overflow-hidden"
    >
      {/* Status glow line */}
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{
        background: agent.status === "working" ? agent.color : "transparent",
        opacity: 0.7,
      }} />

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-[10px] font-extrabold flex-shrink-0"
            style={{ background: agent.color + "20", color: agent.color, border: `1px solid ${agent.color}30` }}
          >
            {agent.label[0]}
          </div>
          <div>
            <div className="text-xs font-semibold leading-tight">{agent.label}</div>
            <div className={`text-[10px] mt-0.5 font-mono ${STATUS_COLOR[agent.status] ?? "text-s-muted"}`}>
              {agent.status}
              {agent.status === "working" && (
                <span className="inline-block ml-1 w-1 h-1 rounded-full bg-s-green animate-pulse" />
              )}
            </div>
          </div>
        </div>

        <button
          onClick={toggle}
          disabled={loading}
          aria-label={isOn ? "Pause agent" : "Resume agent"}
          className="flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] transition-all disabled:opacity-40"
          style={isOn
            ? { borderColor: agent.color + "40", color: agent.color, background: agent.color + "10" }
            : { borderColor: "#333", color: "#555" }
          }
        >
          {loading ? "…" : isOn ? "ON" : "OFF"}
        </button>
      </div>

      {agent.repo && (
        <div className="text-[10px] text-s-muted font-mono mb-1 truncate">
          → {agent.repo}
        </div>
      )}
      {agent.task && (
        <div className="text-[10px] text-s-text truncate mb-2">{agent.task}</div>
      )}

      <div className="flex gap-4 mt-2 pt-2 border-t border-s-border">
        <div>
          <div className="text-[9px] text-s-dim uppercase tracking-wide">Completed</div>
          <div className="text-sm font-bold font-mono text-s-green">{agent.completedTasks}</div>
        </div>
        <div>
          <div className="text-[9px] text-s-dim uppercase tracking-wide">Failed</div>
          <div className="text-sm font-bold font-mono text-s-red">{agent.failedTasks}</div>
        </div>
        <div className="flex-1" />
        <div className="text-[9px] text-s-dim self-end font-mono">
          {agent.completedTasks + agent.failedTasks > 0
            ? `${Math.round((agent.completedTasks / (agent.completedTasks + agent.failedTasks)) * 100)}% success`
            : "no tasks yet"}
        </div>
      </div>
    </motion.div>
  );
}

export function AgentsView({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [pausing, setPausing] = useState(false);

  const pauseAll = async () => {
    setPausing(true);
    try {
      await callAction("/api/system/pause");
      router.refresh();
    } catch {}
    setPausing(false);
  };

  const sorted = [...agents].sort((a, b) => b.completedTasks - a.completedTasks);

  return (
    <div className="p-5 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs text-s-muted">{agents.length} agents configured</span>
        <div className="flex gap-2">
          <button
            onClick={pauseAll}
            disabled={pausing}
            className="px-3 py-1.5 text-[11px] rounded border border-s-amber/40 text-s-amber hover:bg-s-amber/10 transition-all disabled:opacity-40"
          >
            {pausing ? "Pausing…" : "Pause All"}
          </button>
          <button
            onClick={() => callAction("/api/system/resume").then(() => router.refresh())}
            className="px-3 py-1.5 text-[11px] rounded border border-s-green/40 text-s-green hover:bg-s-green/10 transition-all"
          >
            Resume All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {agents.map((agent, i) => (
          <AgentCard key={agent.id} agent={agent} index={i} />
        ))}
      </div>

      {/* Leaderboard */}
      <div className="border border-s-border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-s-border bg-white/[0.01] text-[10px] font-bold uppercase tracking-widest text-s-dim">
          Leaderboard — All Time
        </div>
        {sorted.map((agent, i) => (
          <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02]">
            <span className="text-[11px] font-mono text-s-dim w-4">{i + 1}</span>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agent.color }} />
            <span className="flex-1 text-xs font-medium truncate">{agent.label}</span>
            <span className="text-[11px] font-mono text-s-green">{agent.completedTasks} done</span>
            <span className="text-[10px] font-mono text-s-red">{agent.failedTasks} fails</span>
          </div>
        ))}
      </div>
    </div>
  );
}
