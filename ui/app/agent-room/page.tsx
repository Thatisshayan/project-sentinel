"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AGENTS, FEED } from "@/lib/data";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/lib/api";

const CHIPS = ["/sentinel report", "/sentinel audit", "/sentinel status", "/sprint approve", "/agents list"];

const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  AGENTS.map(a => [a.name.toLowerCase(), a.color])
);
function agentColor(label: string) {
  return AGENT_COLORS[label?.toLowerCase()] ?? "#888888";
}

interface Msg { agent: string; color: string; text: string; ts: string; isCommand?: boolean; }

function toMsg(m: AgentMessage): Msg {
  return {
    agent: m.agent_label,
    color: agentColor(m.agent_label),
    text:  m.message,
    ts:    relTime(m.created_at),
  };
}

function relTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m/60)}h`;
}

export default function AgentRoomPage() {
  const [msgs, setMsgs] = useState<Msg[]>(
    FEED.map(e => ({ agent: e.agent, color: e.color, text: e.msg, ts: e.time }))
  );

  // Load real messages on mount
  useEffect(() => {
    fetch('/api/agent-room-proxy')
      .then(r => r.ok ? r.json() : null)
      .then((data: AgentMessage[] | null) => {
        if (data && data.length > 0) {
          setMsgs(data.map(toMsg));
        }
      })
      .catch(() => {});
  }, []);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMsgs(m => [...m, { agent: "You", color: "#C8961C", text, ts: "now", isCommand: text.startsWith("/") }]);
    setInput("");
    // Simulate response
    setTimeout(() => {
      setMsgs(m => [...m, {
        agent: "Sentinel",
        color: "#6366F1",
        text: text.startsWith("/sentinel report")
          ? "📊 Portfolio health avg: 74 · 4 agents working · 52 tasks queued · $12.40 spent this month"
          : `Acknowledged: ${text}`,
        ts: "now",
      }]);
    }, 800);
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Agent list sidebar */}
      <div className="w-[180px] flex-shrink-0 border-r border-s-border flex flex-col">
        <div className="px-3 py-2.5 border-b border-s-border text-[9px] font-bold uppercase tracking-widest text-s-dim">
          Agents
        </div>
        {AGENTS.map(a => (
          <div key={a.id} className="flex items-center gap-2 px-3 py-2 border-b border-s-border hover:bg-white/[0.02]">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: a.color,
                opacity: a.status === "idle" ? 0.3 : 1,
                boxShadow: a.status === "working" ? `0 0 5px ${a.color}` : undefined,
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{a.name}</div>
              <div className="text-[9px] text-s-dim truncate">{a.status}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Message feed */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono">
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
