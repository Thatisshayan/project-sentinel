"use client";
import { motion } from "framer-motion";
import type { Repo, Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, MoreHorizontal } from "lucide-react";

const PRIORITY: Record<string, string> = {
  P0: "text-[#EF4444] bg-[#EF4444]/10 border-[#EF4444]/20",
  P1: "text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/20",
  P2: "text-[#888888] bg-white/5      border-[#222222]",
};

function BuildIcon({ status }: { status: Repo["build"] }) {
  if (status === "pass")    return <CheckCircle2 size={11} className="text-[#22C55E]" />;
  if (status === "fail")    return <XCircle      size={11} className="text-[#EF4444]" />;
  return <Clock size={11} className="text-[#F59E0B] animate-spin" style={{ animationDuration: "3s" }} />;
}

interface Props { repo: Repo; agent: Agent | null; index: number; healthColor: string; secColor: string; }

export function RepoRow({ repo, agent, index, healthColor, secColor }: Props) {
  const isWorking = !!agent && agent.status === "working";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.03, duration: 0.2 }}
      className={cn(
        "group relative border-b border-[#1c1c1c] hover:bg-white/[0.022] transition-colors duration-100 cursor-pointer",
        isWorking && "bg-[#6366F1]/[0.025]"
      )}
      style={{ display: "grid", gridTemplateColumns: "18px 1fr 96px 72px 76px 28px", gap: "10px", alignItems: "center", padding: "8px 14px" }}
    >
      {/* Left health indicator */}
      <div className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-sm transition-all"
        style={{ background: healthColor, opacity: isWorking ? 1 : 0.35 }} />

      {/* Build icon */}
      <div className="flex justify-center">
        <BuildIcon status={repo.build} />
      </div>

      {/* Name + agent */}
      <div className="min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[12px] font-medium text-[#F5F5F5] truncate">{repo.name}</span>
          <span className={cn("text-[8px] font-bold px-[5px] py-[1px] rounded border font-mono flex-shrink-0", PRIORITY[repo.priority])}>
            {repo.priority}
          </span>
          {repo.tasks > 0 && (
            <span className="text-[9px] text-[#555555] font-mono flex-shrink-0">{repo.tasks}t</span>
          )}
        </div>
        {agent ? (
          <div className="flex items-center gap-1 mt-[2px]">
            <span className="w-[5px] h-[5px] rounded-full flex-shrink-0"
              style={{ background: agent.color, boxShadow: isWorking ? `0 0 4px ${agent.color}` : undefined }} />
            <span className="text-[10px] text-[#888888] truncate">{agent.name}</span>
            {isWorking && (
              <span className="flex gap-[2px] ml-1">
                {[0,1,2].map(d => (
                  <span key={d} className="w-[3px] h-[3px] rounded-full typing-dot"
                    style={{ background: agent.color, animationDelay: `${d * 0.2}s` }} />
                ))}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-[#444444] mt-[2px] block">unassigned</span>
        )}
      </div>

      {/* Health bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-[3px] bg-[#1e1e1e] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${repo.health}%` }}
            transition={{ delay: index * 0.03 + 0.2, duration: 0.7, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: healthColor }}
          />
        </div>
        <span className="text-[10px] font-mono w-5 text-right tabular-nums" style={{ color: healthColor }}>{repo.health}</span>
      </div>

      {/* Security bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-[3px] bg-[#1e1e1e] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${repo.security}%` }}
            transition={{ delay: index * 0.03 + 0.25, duration: 0.7, ease: "easeOut" }}
            className="h-full rounded-full"
            style={{ background: secColor }}
          />
        </div>
        <span className="text-[10px] font-mono w-5 text-right tabular-nums" style={{ color: secColor }}>{repo.security}</span>
      </div>

      {/* Commit */}
      <span className="text-[10px] text-[#555555] font-mono truncate">{repo.commit}</span>

      {/* Actions */}
      <div className="flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <button className="p-1 rounded hover:bg-white/10 text-[#666666] hover:text-[#F5F5F5] transition-colors">
          <MoreHorizontal size={12} />
        </button>
      </div>
    </motion.div>
  );
}
