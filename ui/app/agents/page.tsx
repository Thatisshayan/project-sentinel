"use client";
import { motion } from "framer-motion";
import { AGENTS } from "@/lib/data";
import { cn } from "@/lib/utils";
import { ToggleLeft, ToggleRight, Activity } from "lucide-react";
import { useState } from "react";

const STATUS_LABEL: Record<string, string> = {
  working: "Working",
  idle:    "Idle",
  failed:  "Failed",
};
const STATUS_COLOR: Record<string, string> = {
  working: "text-s-green",
  idle:    "text-s-muted",
  failed:  "text-s-red",
};

export default function AgentsPage() {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs text-s-muted">8 agents configured</span>
        <button className="px-3 py-1.5 text-[11px] rounded border border-s-ind/40 text-s-ind hover:bg-s-ind/10 transition-all">
          + Add Agent
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {AGENTS.map((agent, i) => (
          <AgentCard key={agent.id} agent={agent} index={i} />
        ))}
      </div>

      {/* Leaderboard */}
      <div className="mt-6 border border-s-border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-s-border bg-white/[0.01] text-[10px] font-bold uppercase tracking-widest text-s-dim">
          Week 24 Leaderboard
        </div>
        {[...AGENTS].sort((a,b) => b.done - a.done).map((agent, i) => (
          <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02]">
            <span className="text-[11px] font-mono text-s-dim w-4">{i + 1}</span>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agent.color }} />
            <span className="flex-1 text-xs font-medium">{agent.name}</span>
            <span className="text-[11px] font-mono text-s-muted">{agent.done} tasks</span>
            <span className="text-[11px] font-mono text-s-green">{agent.prs} PRs</span>
            <span className="text-[10px] font-mono text-s-red">{agent.fails} fails</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent, index }: { agent: typeof AGENTS[0]; index: number }) {
  const [on, setOn] = useState(agent.status !== "failed");
  const isWorking = agent.status === "working";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      className={cn(
        "relative border border-s-border rounded-lg p-3.5 transition-all duration-150",
        isWorking && "border-s-ind/20 bg-s-ind/[0.02]",
        agent.status === "failed" && "border-s-red/20 bg-s-red/[0.02]"
      )}
    >
      {isWorking && (
        <div className="absolute inset-0 rounded-lg pointer-events-none"
          style={{ boxShadow: `inset 0 0 0 1px ${agent.color}15` }} />
      )}

      <div className="flex items-start justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{
              background: on ? agent.color : "#444",
              boxShadow: isWorking && on ? `0 0 8px ${agent.color}80` : undefined,
            }}
          />
          <span className="text-sm font-semibold">{agent.name}</span>
        </div>
        <button onClick={() => setOn(v => !v)} className="text-s-muted hover:text-s-text transition-colors" aria-label="Toggle agent">
          {on ? <ToggleRight size={18} className="text-s-ind" /> : <ToggleLeft size={18} />}
        </button>
      </div>

      <div className="text-[10px] font-mono text-s-dim mb-2.5 truncate">{agent.model}</div>

      <div className={cn("text-[10px] font-semibold mb-2", STATUS_COLOR[agent.status])}>
        {STATUS_LABEL[agent.status]}
        {isWorking && (
          <span className="inline-flex gap-0.5 ml-1.5">
            {[0,1,2].map(d => (
              <span key={d} className="w-[3px] h-[3px] rounded-full typing-dot" style={{ background: agent.color, animationDelay:`${d*.2}s` }} />
            ))}
          </span>
        )}
      </div>

      {agent.task && (
        <div className="text-[11px] text-s-muted mb-2.5 line-clamp-1 leading-snug">{agent.task}</div>
      )}
      {agent.repo && (
        <div className="font-mono text-[10px] text-s-dim mb-2.5">{agent.repo}</div>
      )}

      <div className="flex gap-3 text-[10px] font-mono border-t border-s-border pt-2.5 mt-auto">
        <span className="text-s-muted"><span className="text-s-text font-semibold">{agent.done}</span> tasks</span>
        <span className="text-s-muted"><span className="text-s-green font-semibold">{agent.prs}</span> PRs</span>
        <span className="text-s-muted"><span className="text-s-red font-semibold">{agent.fails}</span> fails</span>
      </div>
    </motion.div>
  );
}
