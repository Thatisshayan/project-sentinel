export interface RepoAutomationPolicy {
  allowTaskExecution: boolean;
  allowPrOpen: boolean;
  allowPrUpdate: boolean;
  allowAutoPush: boolean;
}

export const DEFAULT_REPO_AUTOMATION_POLICY: RepoAutomationPolicy = {
  allowTaskExecution: true,
  allowPrOpen: true,
  allowPrUpdate: true,
  allowAutoPush: true,
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
