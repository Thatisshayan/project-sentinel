export type RepoAutomationPreset =
  | 'audit-only'
  | 'propose-only'
  | 'execute-no-push'
  | 'full-auto'
  | 'custom';

export interface RepoAutomationPolicy {
  allowTaskExecution: boolean;
  allowPrOpen: boolean;
  allowPrUpdate: boolean;
  allowAutoPush: boolean;
}

export interface RepoAutomationPolicyState {
  preset: RepoAutomationPreset;
  policy: RepoAutomationPolicy;
}

export const DEFAULT_REPO_AUTOMATION_POLICY: RepoAutomationPolicy = {
  allowTaskExecution: true,
  allowPrOpen: true,
  allowPrUpdate: true,
  allowAutoPush: true,
};

export const REPO_AUTOMATION_PRESETS: Record<Exclude<RepoAutomationPreset, 'custom'>, RepoAutomationPolicy> = {
  'audit-only': {
    allowTaskExecution: false,
    allowPrOpen: false,
    allowPrUpdate: false,
    allowAutoPush: false,
  },
  'propose-only': {
    allowTaskExecution: false,
    allowPrOpen: true,
    allowPrUpdate: false,
    allowAutoPush: false,
  },
  'execute-no-push': {
    allowTaskExecution: true,
    allowPrOpen: false,
    allowPrUpdate: false,
    allowAutoPush: false,
  },
  'full-auto': {
    ...DEFAULT_REPO_AUTOMATION_POLICY,
  },
};

export function normalizeRepoAutomationPolicy(
  policy?: Partial<RepoAutomationPolicy> | null
): RepoAutomationPolicy {
  return {
    allowTaskExecution: policy?.allowTaskExecution ?? DEFAULT_REPO_AUTOMATION_POLICY.allowTaskExecution,
    allowPrOpen: policy?.allowPrOpen ?? DEFAULT_REPO_AUTOMATION_POLICY.allowPrOpen,
    allowPrUpdate: policy?.allowPrUpdate ?? DEFAULT_REPO_AUTOMATION_POLICY.allowPrUpdate,
    allowAutoPush: policy?.allowAutoPush ?? DEFAULT_REPO_AUTOMATION_POLICY.allowAutoPush,
  };
}

export function policyEquals(a: RepoAutomationPolicy, b: RepoAutomationPolicy): boolean {
  return (
    a.allowTaskExecution === b.allowTaskExecution &&
    a.allowPrOpen === b.allowPrOpen &&
    a.allowPrUpdate === b.allowPrUpdate &&
    a.allowAutoPush === b.allowAutoPush
  );
}

export function getRepoAutomationPresetForPolicy(policy: RepoAutomationPolicy): RepoAutomationPreset {
  for (const [preset, presetPolicy] of Object.entries(REPO_AUTOMATION_PRESETS) as Array<[Exclude<RepoAutomationPreset, 'custom'>, RepoAutomationPolicy]>) {
    if (policyEquals(policy, presetPolicy)) {
      return preset;
    }
  }
  return 'custom';
}

export function getRepoAutomationPolicyState(
  policy?: Partial<RepoAutomationPolicy> | null,
  preset?: string | null
): RepoAutomationPolicyState {
  const normalized = normalizeRepoAutomationPolicy(policy);
  if (preset && preset in REPO_AUTOMATION_PRESETS) {
    const knownPreset = preset as Exclude<RepoAutomationPreset, 'custom'>;
    if (policyEquals(normalized, REPO_AUTOMATION_PRESETS[knownPreset])) {
      return { preset: knownPreset, policy: normalized };
    }
  }
  return {
    preset: getRepoAutomationPresetForPolicy(normalized),
    policy: normalized,
  };
}

export function applyRepoAutomationPreset(preset: Exclude<RepoAutomationPreset, 'custom'>): RepoAutomationPolicy {
  return { ...REPO_AUTOMATION_PRESETS[preset] };
}

export function getTaskExecutionPolicyBlockReason(
  policy: RepoAutomationPolicy,
  hasExistingBranch: boolean
): string | null {
  if (!policy.allowTaskExecution) {
    return 'Task execution is disabled by repo policy.';
  }
  if (!policy.allowAutoPush) {
    return 'Auto-push is disabled by repo policy.';
  }
  if (hasExistingBranch && !policy.allowPrUpdate) {
    return 'Updating an existing Sentinel PR is disabled by repo policy.';
  }
  if (!hasExistingBranch && !policy.allowPrOpen) {
    return 'Opening a new Sentinel PR is disabled by repo policy.';
  }
  return null;
}
