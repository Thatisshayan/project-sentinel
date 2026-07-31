"use client";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { AGENTS } from "@/lib/data";
import { callAction } from "@/lib/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { priorityColor } from "@/lib/theme";
import { fadeInStagger, growHeight, useSafeReducedMotion } from "@/lib/motion";
import { ColorBadge } from "./color-badge";
import { MeterBar } from "./meter-bar";
import { PagePanel } from "./page-panel";
import { ApiErrorBanner, EmptyNote } from "./empty-state";

interface DisplayTask {
  title: string;
  agent: string | null;
  status: 'done' | 'working' | 'blocked' | 'todo';
  priority: string;
  id: number;
}

interface DisplaySprint {
  name: string; start: string; end: string; progress: number; id: number; status: string;
}

interface VelocityPoint { value: number; label: string; }

function StatusIcon({ s }: { s: string }) {
  if (s === "done")    return <CheckCircle2 size={13} className="text-s-green flex-shrink-0" />;
  if (s === "working") return <Clock size={13} className="text-s-ind flex-shrink-0 animate-spin" style={{ animationDuration:"3s" }} />;
  if (s === "blocked") return <AlertCircle size={13} className="text-s-red flex-shrink-0" />;
  return <span className="w-3 h-3 rounded-full border border-s-border flex-shrink-0" />;
}

export function SprintView({
  sprint, tasks, velocity, loadError,
}: {
  sprint: DisplaySprint | null; tasks: DisplayTask[]; velocity: VelocityPoint[];
  loadError?: boolean;
}) {
  const router = useRouter();
  const reduced = useSafeReducedMotion();
  const maxV   = Math.max(...velocity.map(v => v.value), 1);
  const [pausing, setPausing] = useState(false);

  const handleApprove = async () => {
    if (!sprint?.id) return;
    try {
      await callAction("/api/sprint/approve", { sprintId: sprint.id });
      router.refresh();
    } catch {}
  };

  const handleSkip = async () => {
    if (!sprint?.id) return;
    try {
      await callAction("/api/sprint/skip", { sprintId: sprint.id });
      router.refresh();
    } catch {}
  };

  const handlePause = async () => {
    if (!sprint?.id) return;
    setPausing(true);
    try {
      await callAction("/api/command", { text: "/sentinel pause-sprint", fromName: "Dashboard" });
      router.refresh();
    } catch {}
    setPausing(false);
  };

  return (
    <div className="p-5 space-y-5">
      {loadError && <ApiErrorBanner label="sprint" />}
      {/* Sprint card */}
      {sprint ? (
        <div className="border border-s-border rounded-lg overflow-hidden">
          <div className="flex items-start justify-between px-4 py-3.5 border-b border-s-border">
            <div>
              <div className="font-bold text-base">{sprint.name}</div>
              <div className="text-[11px] text-s-muted font-mono mt-0.5">{sprint.start} → {sprint.end}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleApprove} className="px-3 py-1.5 text-[11px] rounded border transition-all border-s-green/40 text-s-green hover:bg-s-green/10">Approve</button>
              <button onClick={handleSkip}    className="px-3 py-1.5 text-[11px] rounded border transition-all border-s-amber/40 text-s-amber hover:bg-s-amber/10">Skip</button>
              <button
                onClick={handlePause}
                disabled={pausing || !sprint.id}
                className="px-3 py-1.5 text-[11px] rounded border transition-all border-s-border text-s-muted hover:text-s-text disabled:opacity-40"
              >
                {pausing ? "Pausing…" : "Pause"}
              </button>
            </div>
          </div>
          <div className="px-4 py-3 bg-white/[0.01]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-s-muted">Progress</span>
              <span className="text-[11px] font-mono font-bold text-s-ind">{sprint.progress}%</span>
            </div>
            <MeterBar pct={sprint.progress} color="#6366F1" height={6} />
          </div>
        </div>
      ) : !loadError && (
        <EmptyNote className="border border-s-border rounded-lg py-6">
          No active sprint this week. Propose one via <span className="font-mono">/sentinel propose-sprint</span>.
        </EmptyNote>
      )}

      <div className="grid grid-cols-[1fr_240px] gap-5">
        {/* Task list */}
        <PagePanel title={`Tasks (${tasks.length})`}>
          {tasks.length > 0 ? tasks.map((task, i) => {
            const agent = AGENTS.find(a => a.name === task.agent);
            return (
              <motion.div
                key={task.id || i}
                {...fadeInStagger(i, !!reduced, "x")}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02]"
              >
                <StatusIcon s={task.status} />
                <span className="flex-1 text-xs text-s-text">{task.title}</span>
                <ColorBadge color={priorityColor(task.priority)} size="xs" uppercase>{task.priority}</ColorBadge>
                {agent && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: agent.color }} />
                    <span className="text-[10px] text-s-muted">{task.agent}</span>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button
                    disabled
                    title="Not yet wired — approve individual tasks via Telegram (/sentinel tasks)"
                    className="text-[10px] px-2 py-0.5 rounded border border-s-border text-s-muted opacity-40 cursor-not-allowed"
                  >
                    Execute
                  </button>
                  <button
                    disabled
                    title="Not yet wired — approve individual tasks via Telegram (/sentinel tasks)"
                    className="text-[10px] px-2 py-0.5 rounded border border-s-border text-s-dim opacity-40 cursor-not-allowed"
                  >
                    Skip
                  </button>
                </div>
              </motion.div>
            );
          }) : (
            <EmptyNote>No tasks.</EmptyNote>
          )}
        </PagePanel>

        {/* Velocity chart */}
        <PagePanel title={`Velocity (last ${velocity.length} sprints)`}>
          {velocity.length > 0 ? (
            <div className="p-4 flex items-end gap-2 h-[180px]">
              {velocity.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <motion.div
                    {...growHeight((v.value / maxV) * 100, !!reduced, i * 0.06)}
                    className="w-full rounded-t"
                    style={{
                      background: i === velocity.length-1 ? "var(--s-ind)" : "#2e2e2e",
                      minHeight: 4,
                    }}
                  />
                  <span className="text-[8px] font-mono text-s-dim">{v.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote>No velocity data yet.</EmptyNote>
          )}
        </PagePanel>
      </div>
    </div>
  );
}
