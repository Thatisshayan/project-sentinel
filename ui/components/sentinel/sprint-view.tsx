"use client";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { AGENTS } from "@/lib/data";
import { approveSprint, skipSprint } from "@/lib/api";
import { callAction } from "@/lib/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  sprint, tasks, velocity, isDemoData, demoReason,
}: {
  sprint: DisplaySprint; tasks: DisplayTask[]; velocity: VelocityPoint[];
  isDemoData?: boolean; demoReason?: string;
}) {
  const router = useRouter();
  const maxV   = Math.max(...velocity.map(v => v.value), 1);
  const [pausing, setPausing] = useState(false);

  const handleApprove = async () => {
    if (!sprint.id) return;
    await approveSprint(sprint.id).catch(() => {});
    router.refresh();
  };

  const handleSkip = async () => {
    if (!sprint.id) return;
    await skipSprint(sprint.id).catch(() => {});
    router.refresh();
  };

  const handlePause = async () => {
    if (!sprint.id) return;
    setPausing(true);
    try {
      await callAction("/api/command", { text: "/sentinel pause-sprint", fromName: "Dashboard" });
      router.refresh();
    } catch {}
    setPausing(false);
  };

  return (
    <div className="p-5 space-y-5">
      {isDemoData && (
        <div className="px-4 py-2.5 rounded-lg border border-s-amber/40 bg-s-amber/10 text-[11px] text-s-amber font-mono">
          ⚠ {demoReason || "Showing example data"}
        </div>
      )}
      {/* Sprint card */}
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
          <div className="h-1.5 bg-s-border rounded-full overflow-hidden">
            <motion.div
              initial={{ width:0 }}
              animate={{ width:`${sprint.progress}%` }}
              transition={{ duration:0.8, ease:"easeOut" }}
              className="h-full rounded-full bg-s-ind"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_240px] gap-5">
        {/* Task list */}
        <div className="border border-s-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-s-border text-[10px] font-bold uppercase tracking-widest text-s-dim bg-white/[0.01]">
            Tasks ({tasks.length})
          </div>
          {tasks.map((task, i) => {
            const agent = AGENTS.find(a => a.name === task.agent);
            return (
              <motion.div
                key={task.id || i}
                initial={{ opacity:0, x:-4 }}
                animate={{ opacity:1, x:0 }}
                transition={{ delay: i*0.04 }}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02]"
              >
                <StatusIcon s={task.status} />
                <span className="flex-1 text-xs text-s-text">{task.title}</span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  task.priority==="P0" ? "text-s-red bg-s-red/10" :
                  task.priority==="P1" ? "text-s-amber bg-s-amber/10" : "text-s-muted bg-white/5"
                }`}>{task.priority}</span>
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
          })}
        </div>

        {/* Velocity chart */}
        <div className="border border-s-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-s-border text-[10px] font-bold uppercase tracking-widest text-s-dim bg-white/[0.01]">
            Velocity (last {velocity.length} sprints)
          </div>
          <div className="p-4 flex items-end gap-2 h-[180px]">
            {velocity.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <motion.div
                  initial={{ height:0 }}
                  animate={{ height:`${(v.value / maxV) * 100}%` }}
                  transition={{ delay: i*0.06, duration:0.5, ease:"easeOut" }}
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
        </div>
      </div>
    </div>
  );
}
