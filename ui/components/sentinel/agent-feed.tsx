"use client";
import { motion } from "framer-motion";
import type { FeedEntry } from "@/lib/types";
import { fadeInStagger, useSafeReducedMotion } from "@/lib/motion";

export function AgentFeed({ entries }: { entries: FeedEntry[] }) {
  const reduced = useSafeReducedMotion();
  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((e, i) => (
        <motion.div
          key={i}
          {...fadeInStagger(i, !!reduced, "x")}
          className="flex gap-2.5 px-3.5 py-2.5 border-b border-s-border hover:bg-white/[0.02] transition-colors"
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
            style={{ background: e.color, boxShadow: `0 0 4px ${e.color}60` }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold" style={{ color: e.color }}>{e.agent}</span>
              <span className="text-[9px] font-mono text-s-dim">{e.repo}</span>
            </div>
            <p className="text-[11px] text-s-muted leading-snug mt-0.5 line-clamp-2">{e.msg}</p>
          </div>
          <span className="text-[9px] font-mono text-s-dim flex-shrink-0 mt-0.5">{e.time}</span>
        </motion.div>
      ))}
    </div>
  );
}
