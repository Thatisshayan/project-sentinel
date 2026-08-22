"use client";

import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions";
import type { RepoAutomationPolicy } from "@/lib/api";

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

export function RepoPolicyPanel({ repoName, policy }: { repoName: string; policy: RepoAutomationPolicy }) {
  const router = useRouter();

  async function updatePolicy(patch: Partial<RepoAutomationPolicy>) {
    await callAction(`/api/repo/${repoName}/policy`, patch);
    router.refresh();
  }

  return (
    <div className="px-4">
      <PolicyToggle
        label="Allow task execution"
        description="If disabled, Sentinel can still audit and queue work, but it will not execute tasks for this repo."
        checked={policy.allowTaskExecution}
        onChange={(checked) => updatePolicy({ allowTaskExecution: checked })}
      />
      <PolicyToggle
        label="Allow opening PRs"
        description="Controls whether Sentinel may open a brand-new PR when no active working PR exists."
        checked={policy.allowPrOpen}
        onChange={(checked) => updatePolicy({ allowPrOpen: checked })}
      />
      <PolicyToggle
        label="Allow updating PRs"
        description="Controls whether Sentinel may keep pushing additional commits to an existing working PR."
        checked={policy.allowPrUpdate}
        onChange={(checked) => updatePolicy({ allowPrUpdate: checked })}
      />
      <PolicyToggle
        label="Allow auto-push"
        description="Controls whether Sentinel may push execution branches to GitHub at all."
        checked={policy.allowAutoPush}
        onChange={(checked) => updatePolicy({ allowAutoPush: checked })}
      />
    </div>
  );
}
