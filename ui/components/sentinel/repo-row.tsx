"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { Repo, Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, MoreHorizontal, Loader2 } from "lucide-react";
import { callAction } from "@/lib/actions";
import { priorityColor } from "@/lib/theme";
import { fadeInStagger, useSafeReducedMotion } from "@/lib/motion";
import { ColorBadge } from "./color-badge";
import { MeterBar } from "./meter-bar";

function BuildIcon({ status }: { status: Repo["build"] }) {
  if (status === "pass")    return <CheckCircle2 size={11} className="text-s-green" />;
  if (status === "fail")    return <XCircle      size={11} className="text-s-red" />;
  return <Clock size={11} className="text-s-amber animate-spin" style={{ animationDuration: "3s" }} />;
}

interface Props { repo: Repo; agent: Agent | null; index: number; healthColor: string; secColor: string; }

export function RepoRow({ repo, agent, index, healthColor, secColor }: Props) {
  const router = useRouter();
  const reduced = useSafeReducedMotion();
  const [auditing, setAuditing] = useState(false);
  const isWorking = !!agent && agent.status === "working";

  const audit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setAuditing(true);
    try { await callAction(`/api/repo/${repo.name}/audit`); } catch {}
    setAuditing(false);
    router.refresh();
  };

  return (
    <Link href={`/repos/${repo.name}`} className="contents">
      <motion.div
        {...fadeInStagger(index, !!reduced)}
        className={cn(
          "group relative border-b border-[#1c1c1c] hover:bg-white/[0.022] transition-colors duration-100 cursor-pointer",
          isWorking && "bg-s-ind/[0.025]"
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
            <span className="font-mono text-[12px] font-medium text-s-text truncate">{repo.name}</span>
            <ColorBadge color={priorityColor(repo.priority)} size="2xs" bordered>
              {repo.priority}
            </ColorBadge>
            {repo.tasks > 0 && (
              <span className="text-[9px] text-[#555555] font-mono flex-shrink-0">{repo.tasks}t</span>
            )}
          </div>
          {agent ? (
            <div className="flex items-center gap-1 mt-[2px]">
              <span className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{ background: agent.color, boxShadow: isWorking ? `0 0 4px ${agent.color}` : undefined }} />
              <span className="text-[10px] text-s-muted truncate">{agent.name}</span>
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
            <span className="text-[10px] text-s-dim mt-[2px] block">unassigned</span>
          )}
        </div>

        {/* Health bar */}
        <div className="flex items-center gap-2">
          <MeterBar pct={repo.health} color={healthColor} delay={index * 0.03 + 0.2} />
          <span className="text-[10px] font-mono w-5 text-right tabular-nums" style={{ color: healthColor }}>{repo.health}</span>
        </div>

        {/* Security bar */}
        <div className="flex items-center gap-2">
          <MeterBar pct={repo.security} color={secColor} delay={index * 0.03 + 0.25} />
          <span className="text-[10px] font-mono w-5 text-right tabular-nums" style={{ color: secColor }}>{repo.security}</span>
        </div>

        {/* Commit */}
        <span className="text-[10px] text-[#555555] font-mono truncate">{repo.commit}</span>

        {/* Actions */}
        <div className="flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={audit}
            disabled={auditing}
            aria-label="Audit repo"
            title="Audit this repo"
            className="p-1 rounded hover:bg-white/10 text-[#666666] hover:text-s-text transition-colors disabled:opacity-40"
          >
            {auditing ? <Loader2 size={12} className="animate-spin" /> : <MoreHorizontal size={12} />}
          </button>
        </div>
      </motion.div>
    </Link>
  );
}
