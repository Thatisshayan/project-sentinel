"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage, AgentRow } from "@/lib/api";

const CHIPS = ["/sentinel report", "/sentinel status", "/sentinel audit tapcash", "/agents list", "/sprint status"];

const PROVIDER_COLORS: Record<string, string> = {
  nvidia: "#6366F1", nemotron: "#6366F1", hermes: "#6366F1",
  qwen: "#F59E0B", gemini: "#22C55E", llama: "#3B82F6",
  deepseek: "#8B5CF6", aider: "#14B8A6", dashboard: "#C8961C",
};
function agentColor(label: string) {
  const l = label?.toLowerCase() ?? "";
  for (const [key, color] of Object.entries(PROVIDER_COLORS)) {
    if (l.includes(key)) return color;
  }
  return "#888888";
}

interface Msg { id: string; agent: string; color: string; text: string; ts: string; isMe?: boolean; }

function relTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function msgToMsg(m: AgentMessage): Msg {
  const isMe = m.agent_id === "dashboard_user";
  return {
    id:    String(m.id),
    agent: isMe ? "You" : m.agent_label,
    color: isMe ? "#C8961C" : agentColor(m.agent_label),
    text:  m.message,
    ts:    relTime(m.created_at),
    isMe,
  };
}

export default function AgentRoomPage() {
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [agents, setAgents]   = useState<AgentRow[]>([]);
  const [input, setInput]     = useState("");
  const [sending, setSending] = useState(false);
  const [lastId, setLastId]   = useState<string | null>(null);
  const bottomRef             = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    const r = await fetch("/api/agent-room-proxy").catch(() => null);
    if (!r?.ok) return;
    const data: AgentMessage[] = await r.json().catch(() => []);
    if (!Array.isArray(data) || data.length === 0) return;
    const converted = data.map(msgToMsg);
    const newestId = converted[converted.length - 1]?.id;
    setMsgs(converted);
    setLastId(prev => newestId ?? prev);
  }, []);

  // Initial load
  useEffect(() => {
    fetchMessages();

    fetch("/api/agents-proxy")
      .then(r => r.ok ? r.json() : null)
      .then((data: AgentRow[] | null) => { if (data && data.length > 0) setAgents(data); })
      .catch(() => {});
  }, [fetchMessages]);

  // Poll every 4s for new messages
  useEffect(() => {
    const id = setInterval(fetchMessages, 4000);
    return () => clearInterval(id);
  }, [fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setInput("");

    try {
      await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/api/command", body: { text: text.trim(), fromName: "Shayan" } }),
      });
      // Poll immediately for the echoed user message, then keep polling for Sentinel's reply
      setTimeout(fetchMessages, 500);
      setTimeout(fetchMessages, 2000);
      setTimeout(fetchMessages, 4000);
    } catch {}

    setSending(false);
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
            <div className="text-[11px] text-s-dim text-center mt-8">
              No messages yet — send a command below or check back after Sentinel runs its morning report.
            </div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={cn("flex gap-2.5", m.isMe && "flex-row-reverse")}
              >
                <span
                  className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[8px] font-bold mt-0.5"
                  style={{ background: m.color + "20", color: m.color, border: `1px solid ${m.color}30` }}
                >
                  {m.agent[0]}
                </span>
                <div className={cn("flex flex-col gap-0.5", m.isMe && "items-end")}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10px] font-semibold" style={{ color: m.color }}>{m.agent}</span>
                    <span className="text-[9px] text-s-dim">{m.ts}</span>
                  </div>
                  <div className={cn(
                    "text-[11px] leading-relaxed px-2.5 py-1.5 rounded max-w-[440px] whitespace-pre-wrap",
                    m.isMe
                      ? "bg-s-gold/10 text-s-gold border border-s-gold/20"
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
                disabled={sending}
                className="text-[10px] font-mono px-2 py-1 rounded border border-s-border text-s-muted hover:text-s-text hover:border-s-ind/40 hover:bg-s-ind/5 transition-all disabled:opacity-40"
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
              disabled={sending}
              className="flex-1 bg-s-surface border border-s-border rounded px-3 py-2 text-xs font-mono text-s-text placeholder:text-s-dim outline-none focus:border-s-ind/50 transition-colors disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={sending || !input.trim()}
              className="px-3 py-2 bg-s-ind/10 border border-s-ind/30 rounded text-s-ind hover:bg-s-ind/20 transition-colors disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={13} />
            </button>
          </div>
          <div className="text-[9px] text-s-dim mt-1.5">
            Commands go to Sentinel directly — responses appear here within a few seconds.
          </div>
        </div>
      </div>
    </div>
  );
}
