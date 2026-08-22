"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions";
import type {
  RepoAutomationPolicy,
  RepoAutomationPolicyState,
  RepoAutomationPreset,
  RepoPolicyAuditEntry,
} from "@/lib/api";

function PolicyToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-3 border-b border-s-border last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-s-text">{label}</div>
        <div className="text-[11px] text-s-muted mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 rounded-full border transition-colors ${
          checked ? "bg-s-green/20 border-s-green/40" : "bg-s-surface border-s-border"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-5 bg-s-green" : "translate-x-1 bg-s-muted"
          }`}
        />
      </button>
    </label>
  );
}

const PRESET_OPTIONS: Array<{
  value: Exclude<RepoAutomationPreset, "custom">;
  label: string;
  description: string;
}> = [
  {
    value: "audit-only",
    label: "Audit only",
    description: "Generate findings only. No execution, PR creation, or pushes.",
  },
  {
    value: "propose-only",
    label: "Propose only",
    description: "Sentinel may open a proposal PR, but cannot execute or keep pushing work.",
  },
  {
    value: "execute-no-push",
    label: "Execute, no push",
    description: "Execution stays enabled, but no GitHub branch or PR mutation is allowed.",
  },
  {
    value: "full-auto",
    label: "Full auto",
    description: "Execution, PR creation/updates, and auto-push are all enabled.",
  },
];

function formatPresetLabel(preset: RepoAutomationPreset): string {
  const known = PRESET_OPTIONS.find((option) => option.value === preset);
  if (known) return known.label;
  return "Custom";
}

function formatAuditTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function RepoPolicyPanel({
  repoName,
  policyState,
  auditLog,
}: {
  repoName: string;
  policyState: RepoAutomationPolicyState;
  auditLog: RepoPolicyAuditEntry[];
}) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  async function updatePolicy(body: {
    preset?: Exclude<RepoAutomationPreset, "custom">;
  } & Partial<RepoAutomationPolicy>) {
    setIsSaving(true);
    try {
      await callAction(`/api/repo/${repoName}/policy`, {
        ...body,
        changedBy: "Dashboard",
      });
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  const policy = policyState.policy;

  return (
    <div className="px-4 py-1 space-y-4">
      <div className="rounded-xl border border-s-border bg-s-surface/50 p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-s-text">Preset</div>
            <div className="text-[11px] text-s-muted mt-0.5">
              Presets apply a whole repo execution posture. Manual toggle changes become a custom policy when they stop matching a preset.
            </div>
          </div>
          <div className="text-[11px] font-mono text-s-dim">
            Current: {formatPresetLabel(policyState.preset)}
          </div>
        </div>
        <select
          className="w-full rounded-lg border border-s-border bg-s-bg px-3 py-2 text-sm text-s-text outline-none"
          disabled={isSaving}
          value={policyState.preset === "custom" ? "custom" : policyState.preset}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "custom") return;
            void updatePolicy({ preset: value as Exclude<RepoAutomationPreset, "custom"> });
          }}
        >
          {PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="custom" disabled>
            Custom
          </option>
        </select>
        <div className="text-[11px] text-s-muted">
          {policyState.preset === "custom"
            ? "This repo currently has a custom combination of policy flags."
            : PRESET_OPTIONS.find((option) => option.value === policyState.preset)?.description}
        </div>
      </div>

      <div>
        <PolicyToggle
          label="Allow task execution"
          description="If disabled, Sentinel can still audit and queue work, but it will not execute tasks for this repo."
          checked={policy.allowTaskExecution}
          onChange={(checked) => void updatePolicy({ allowTaskExecution: checked })}
        />
        <PolicyToggle
          label="Allow opening PRs"
          description="Controls whether Sentinel may open a brand-new PR when no active working PR exists."
          checked={policy.allowPrOpen}
          onChange={(checked) => void updatePolicy({ allowPrOpen: checked })}
        />
        <PolicyToggle
          label="Allow updating PRs"
          description="Controls whether Sentinel may keep pushing additional commits to an existing working PR."
          checked={policy.allowPrUpdate}
          onChange={(checked) => void updatePolicy({ allowPrUpdate: checked })}
        />
        <PolicyToggle
          label="Allow auto-push"
          description="Controls whether Sentinel may push execution branches to GitHub at all."
          checked={policy.allowAutoPush}
          onChange={(checked) => void updatePolicy({ allowAutoPush: checked })}
        />
      </div>

      <div className="rounded-xl border border-s-border bg-s-surface/30">
        <div className="border-b border-s-border px-3 py-2">
          <div className="text-sm font-medium text-s-text">Recent Policy Changes</div>
          <div className="text-[11px] text-s-muted mt-0.5">
            Actor, preset transition, and timestamp for the latest repo-policy mutations.
          </div>
        </div>
        {auditLog.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-s-muted">No policy changes recorded yet.</div>
        ) : (
          <div className="divide-y divide-s-border">
            {auditLog.map((entry) => (
              <div key={entry.id} className="px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-s-text">
                    {entry.changedBy}
                  </div>
                  <div className="text-[11px] text-s-dim font-mono">
                    {formatAuditTimestamp(entry.changedAt)}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-s-muted">
                  {formatPresetLabel(entry.presetBefore)} {"->"} {formatPresetLabel(entry.presetAfter)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
