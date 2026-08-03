"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { callAction } from "@/lib/actions";

// Map backend canonical IDs to frontend display names and vice versa
const AGENT_ID_MAP: Record<string, string> = {
  nvidia: "Nemotron",
  qwen_coder: "Qwen Coder",
  gemini: "Gemini",
  llama_fast: "Llama",
  deepseek: "DeepSeek",
  qwen_max: "Qwen Max",
  qwen_turbo: "Qwen Turbo",
  qwen_coder_dash: "Qwen Dash",
};

const AGENT_NAME_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_ID_MAP).map(([id, name]) => [name, id])
);

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-s-border last:border-b-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-[11px] text-s-muted mt-0.5">{desc}</div>}
      </div>
      <div className="flex-shrink-0 ml-4">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-s-border rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-2.5 border-b border-s-border bg-white/[0.01] text-[10px] font-bold uppercase tracking-widest text-s-dim">
        {title}
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [auditCooldown, setAuditCooldown] = useState("12");
  const [maxAgents, setMaxAgents] = useState("4");
  const [dailyReportTime, setDailyReportTime] = useState("07:00");
  const [primaryAgent, setPrimaryAgent] = useState("nvidia");
  const [buildAgent, setBuildAgent] = useState("qwen_coder");
  const [fallbackAgent, setFallbackAgent] = useState("gemini");
  const [telegram, setTelegram] = useState(true);
  const [email, setEmail] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings").then(r => r.json());
      if (response) {
        setAutoApprove(response.auto_approve_tasks ?? false);
        setAuditCooldown(String(response.audit_cooldown_h ?? 12));
        setMaxAgents(String(response.max_active_agents ?? 4));
        setDailyReportTime(response.daily_report_time?.substring(0, 5) ?? "07:00");
        setPrimaryAgent(response.primary_agent ?? "nvidia");
        setBuildAgent(response.build_agent ?? "qwen_coder");
        setFallbackAgent(response.fallback_agent ?? "gemini");
        setTelegram(response.telegram_alerts ?? true);
        setEmail(response.email_digest ?? false);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auto_approve_tasks: autoApprove,
          audit_cooldown_h: parseInt(auditCooldown),
          max_active_agents: parseInt(maxAgents),
          daily_report_time: `${dailyReportTime}:00`,
          primary_agent: primaryAgent,
          build_agent: buildAgent,
          fallback_agent: fallbackAgent,
          telegram_alerts: telegram,
          email_digest: email,
        }),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const pauseAll = async () => {
    setPausing(true);
    try {
      await callAction("/api/system/pause");
      router.refresh();
    } catch {}
    setPausing(false);
  };

  const resumeAll = async () => {
    setResuming(true);
    try {
      await callAction("/api/system/resume");
      router.refresh();
    } catch {}
    setResuming(false);
  };

  if (loading) {
    return <div className="p-5 text-s-muted">Loading settings...</div>;
  }

  return (
    <div className="p-5 max-w-2xl">
      <Section title="System">
        <Row label="Auto-approve tasks" desc="Agents execute tasks without human review">
          <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
        </Row>
        <Row label="Audit cooldown" desc="Minimum time between repo audits">
          <select value={auditCooldown} onChange={(e) => setAuditCooldown(e.target.value)} className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
          </select>
        </Row>
        <Row label="Max active agents" desc="Concurrent agents across all repos">
          <select value={maxAgents} onChange={(e) => setMaxAgents(e.target.value)} className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            <option value="4">4</option>
            <option value="6">6</option>
            <option value="8">8</option>
          </select>
        </Row>
        <Row label="Daily report time" desc="When the overnight summary is generated">
          <input value={dailyReportTime} onChange={(e) => setDailyReportTime(e.target.value)} type="time" className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text font-mono outline-none focus:border-s-ind/50" />
        </Row>
      </Section>

      <Section title="Agent Defaults">
        <Row label="Primary agent">
          <select value={primaryAgent} onChange={(e) => setPrimaryAgent(e.target.value)} className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            {Object.entries(AGENT_ID_MAP).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </Row>
        <Row label="Build agent">
          <select value={buildAgent} onChange={(e) => setBuildAgent(e.target.value)} className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            {Object.entries(AGENT_ID_MAP).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </Row>
        <Row label="Fallback agent">
          <select value={fallbackAgent} onChange={(e) => setFallbackAgent(e.target.value)} className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            {Object.entries(AGENT_ID_MAP).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Notifications">
        <Row label="Telegram alerts" desc="Send agent updates to your Telegram bot">
          <Switch checked={telegram} onCheckedChange={setTelegram} />
        </Row>
        <Row label="Email digest" desc="Daily summary via Resend">
          <Switch checked={email} onCheckedChange={setEmail} />
        </Row>
      </Section>

      <div className="mb-4">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="px-4 py-2 text-sm rounded bg-s-ind text-white hover:bg-s-ind/90 transition-all disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <Section title="Danger Zone">
        <Row label="Pause all agents" desc="Stop all running agents immediately">
          <button
            onClick={pauseAll}
            disabled={pausing}
            className="px-3 py-1.5 text-[11px] rounded border border-s-amber/40 text-s-amber hover:bg-s-amber/10 transition-all disabled:opacity-40"
          >
            {pausing ? "Pausing…" : "Pause All"}
          </button>
        </Row>
        <Row label="Resume all agents" desc="Resume agents paused via the button above">
          <button
            onClick={resumeAll}
            disabled={resuming}
            className="px-3 py-1.5 text-[11px] rounded border border-s-green/40 text-s-green hover:bg-s-green/10 transition-all disabled:opacity-40"
          >
            {resuming ? "Resuming…" : "Resume All"}
          </button>
        </Row>
        <Row label="Reset agent pool" desc="Not yet implemented — no backend endpoint exists for this action">
          <button
            disabled
            title="Not yet implemented"
            className="px-3 py-1.5 text-[11px] rounded border border-s-red/40 text-s-red opacity-40 cursor-not-allowed"
          >
            Reset Pool
          </button>
        </Row>
      </Section>
    </div>
  );
}
