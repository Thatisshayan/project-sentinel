"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { AGENTS } from "@/lib/data";
import { callAction } from "@/lib/actions";

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
  const [autoApprove, setAutoApprove] = useState(false);
  const [telegram, setTelegram]       = useState(true);
  const [email, setEmail]             = useState(false);
  const [pausing, setPausing]         = useState(false);
  const [resuming, setResuming]       = useState(false);

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

  return (
    <div className="p-5 max-w-2xl">
      <Section title="System">
        <Row label="Auto-approve tasks" desc="Agents execute tasks without human review">
          <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
        </Row>
        <Row label="Audit cooldown" desc="Minimum time between repo audits">
          <select className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            <option>6 hours</option><option>12 hours</option><option>24 hours</option>
          </select>
        </Row>
        <Row label="Max active agents" desc="Concurrent agents across all repos">
          <select className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
            <option>4</option><option>6</option><option>8</option>
          </select>
        </Row>
        <Row label="Daily report time" desc="When the overnight summary is generated">
          <input defaultValue="07:00" type="time" className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text font-mono outline-none focus:border-s-ind/50" />
        </Row>
      </Section>

      <Section title="Agent Defaults">
        {[["Primary agent","Nemotron"],["Build agent","Qwen Coder"],["Fallback agent","Gemini"]].map(([label, def]) => (
          <Row key={label} label={label}>
            <select defaultValue={def} className="bg-s-surface border border-s-border rounded px-2 py-1 text-xs text-s-text outline-none focus:border-s-ind/50">
              {AGENTS.map(a => <option key={a.id}>{a.name}</option>)}
            </select>
          </Row>
        ))}
      </Section>

      <Section title="Notifications">
        <Row label="Telegram alerts" desc="Send agent updates to your Telegram bot">
          <Switch checked={telegram} onCheckedChange={setTelegram} />
        </Row>
        <Row label="Email digest" desc="Daily summary via Resend">
          <Switch checked={email} onCheckedChange={setEmail} />
        </Row>
      </Section>

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
