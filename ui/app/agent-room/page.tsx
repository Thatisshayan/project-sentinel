"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage, AgentRow } from "@/lib/api";

const CHIPS = ["/sentinel report", "/sentinel audit", "/sentinel status", "/sprint approve", "/agents list"];

const PROVIDER_COLORS: Record<string, string> = {
  nvidia: "#6366F1", nemotron: "#6366F1", hermes: "#6366F1",
  qwen: "#F59E0B", gemini: "#22C55E", llama: "#3B82F6",
  deepseek: "#8B5CF6", aider: "#14B8A6",
};
function agentColor(label: string) {
  const l = label?.toLowerCase() ?? "";
  for (const [key, color] of Object.entries(PROVIDER_COLORS)) {
    if (l.includes(key)) return color;
  }
  return "#888888";
}

interface Msg { agent: string; color: string; text: string; ts: string; isCommand?: boolean; }

function relTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function toMsg(m: AgentMessage): Msg {
  return { agent: m.agent_label, color: agentColor(m.agent_label), text: m.message, ts: relTime(m.created_at) };
}

export default function AgentRoomPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load real messages
    fetch("/api/agent-room-proxy")
      .then(r => r.ok ? r.json() : null)
      .then((data: AgentMessage[] | null) => {
        if (data && data.length > 0) setMsgs(data.map(toMsg));
      })
      .catch(() => {});

    // Load real agents
    fetch("/api/agents-proxy")
      .then(r => r.ok ? r.json() : null)
      .then((data: AgentRow[] | null) => {
        if (data && data.length > 0) setAgents(data);
      })
      .catch(() => {});

    // Load stats for /sentinel report
    fetch("/api/stats")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => { if (d && !d.error) setStats(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs(m => [...m, { agent: "You", color: "#C8961C", text, ts: "now", isCommand: text.startsWith("/") }]);
    setInput("");
    setTimeout(() => {
      let reply = `Acknowledged: ${text}`;
      if (text.startsWith("/sentinel report") && stats) {
        reply = `Portfolio health avg: ${stats.avgHealth} · ${stats.workingCount} agents working · $${(stats.monthlyCost ?? 0).toFixed(2)} spent this month`;
      } else if (text.startsWith("/agents list") && agents.length > 0) {
        reply = agents.map(a => `${a.agent_label} [${a.status}]`).join(" · ");
      } else if (text.startsWith("/sentinel status")) {
        reply = stats
          ? `${stats.repoCount} repos · ${stats.agentCount} agents · health ${stats.avgHealth}`
          : "Fetching status…";
      }
      setMsgs(m => [...m, { agent: "Sentinel", color: "#6366F1", text: reply, ts: "now" }]);
    }, 600);
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Agent list sidebar */}
      <div className="w-[200px] flex-shrink-0 border-r border-s-border flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-s-border text-[9px] font-bold uppercase tracking-widest text-s-dim flex-shrink-0">
          Agents ({agents.length || "…"})
        </div>
        <div className="flex-1 overflow-y-auto">
          {agents.length > 0 ? agents.map(a => (
            <div key={a.agent_id} className="flex items-center gap-2 px-3 py-2 border-b border-s-border hover:bg-white/[0.02]">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: agentColor(a.agent_label),
                  opacity: a.status === "idle" ? 0.3 : 1,
                  boxShadow: a.status === "working" ? `0 0 5px ${agentColor(a.agent_label)}` : undefined,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium truncate">{a.agent_label}</div>
                <div className="text-[9px] text-s-dim truncate">{a.status}</div>
              </div>
            </div>
          )) : (
            <div className="px-3 py-4 text-[10px] text-s-dim">Loading agents…</div>
          )}
        </div>
      </div>

      {/* Message feed */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono">
          {msgs.length === 0 && (
            <div className="text-[11px] text-s-dim text-center mt-8">Loading agent messages…</div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={cn("flex gap-2.5", m.agent === "You" && "flex-row-reverse")}
              >
                <span
                  className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[8px] font-bold mt-0.5"
                  style={{ background: m.color + "20", color: m.color, border: `1px solid ${m.color}30` }}
                >
                  {m.agent[0]}
                </span>
                <div className={cn("flex flex-col gap-0.5", m.agent === "You" && "items-end")}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10px] font-semibold" style={{ color: m.color }}>{m.agent}</span>
                    <span className="text-[9px] text-s-dim">{m.ts}</span>
                  </div>
                  <div className={cn(
                    "text-[11px] leading-relaxed px-2.5 py-1.5 rounded max-w-[440px]",
                    m.isCommand
                      ? "bg-s-gold/10 text-s-gold border border-s-gold/20"
                      : m.agent === "You"
                        ? "bg-s-ind/10 text-s-text border border-s-ind/20"
                        : "bg-s-surface text-s-muted border border-s-border"
                  )}>
                    {m.text}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-s-border p-3">
          <div className="flex gap-2 mb-2 flex-wrap">
            {CHIPS.map(chip => (
              <button
                key={chip}
                onClick={() => send(chip)}
                className="text-[10px] font-mono px-2 py-1 rounded border border-s-border text-s-muted hover:text-s-text hover:border-s-ind/40 hover:bg-s-ind/5 transition-all"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send(input)}
              placeholder="Type a command or message… (Enter to send)"
              className="flex-1 bg-s-surface border border-s-border rounded px-3 py-2 text-xs font-mono text-s-text placeholder:text-s-dim outline-none focus:border-s-ind/50 transition-colors"
            />
            <button
              onClick={() => send(input)}
              className="px-3 py-2 bg-s-ind/10 border border-s-ind/30 rounded text-s-ind hover:bg-s-ind/20 transition-colors"
              aria-label="Send"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
