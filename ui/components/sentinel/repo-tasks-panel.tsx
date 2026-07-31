"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { AuditTask } from "@/lib/api";
import { severityColor } from "@/lib/theme";
import { fadeInStagger, useSafeReducedMotion } from "@/lib/motion";
import { ColorBadge } from "./color-badge";
import { EmptyNote } from "./empty-state";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = ["all", "queued", "in_progress", "build_check", "done", "failed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function RepoTasksPanel({ tasks }: { tasks: AuditTask[] }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const reduced = useSafeReducedMotion();

  const filtered = useMemo(
    () => (filter === "all" ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter]
  );

  return (
    <div>
      {/* Status filter pills — instant toggle, no transition, since this is a
          high-frequency control rather than a one-off entrance. */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-s-border flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              "text-[9px] font-mono px-2 py-1 rounded border transition-colors",
              filter === s
                ? "border-s-ind/40 bg-s-ind/10 text-s-ind"
                : "border-s-border text-s-muted hover:text-s-text hover:border-s-border2"
            )}
          >
            {s === "all" ? `all (${tasks.length})` : s.replace("_", " ")}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyNote>No tasks match this filter.</EmptyNote>
      ) : (
        <div>
          {filtered.map((task, i) => (
            <motion.div
              key={task.id}
              {...fadeInStagger(i, !!reduced, "x")}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02]"
            >
              <ColorBadge color={severityColor(task.priority)} size="2xs" uppercase>
                {task.priority}
              </ColorBadge>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-s-text truncate">{task.title}</div>
                <div className="text-[9px] text-s-dim font-mono">{task.category}</div>
              </div>
              <span className="text-[9px] font-mono text-s-muted flex-shrink-0">{task.status}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
