import axios from 'axios';
import { getDefaultBranch } from './repoDiscovery';
import { repoFullName } from './repoResolver';

export interface GovernanceStatus {
  repoFullName: string;
  branch: string;
  status: 'healthy' | 'drift' | 'unconfigured';
  branchProtectionConfigured: boolean;
  enforceAdmins: boolean | null;
  requirePullRequestReviews: boolean | null;
  dismissStaleReviews: boolean | null;
  requireUpToDateBranches: boolean | null;
  allowForcePushes: boolean | null;
  allowDeletions: boolean | null;
  requiredStatusChecks: string[];
  missingRequiredChecks: string[];
  drift: string[];
}

const REQUIRED_PROTECTION_CHECKS = ['gate'];

interface GithubProtectionResponse {
  required_status_checks?: {
    strict?: boolean;
    contexts?: string[];
    checks?: Array<{ context?: string | null }>;
  };
  enforce_admins?: { enabled?: boolean };
  required_pull_request_reviews?: { dismiss_stale_reviews?: boolean } | null;
  allow_force_pushes?: { enabled?: boolean };
  allow_deletions?: { enabled?: boolean };
}

function getSentinelGovernanceRepoFullName(): string {
  const configured = process.env['SENTINEL_GOVERNANCE_REPO']?.trim();
  if (configured) return configured;
  return repoFullName('project-sentinel');
}

function buildUnconfiguredGovernanceStatus(
  repoFullName: string,
  branch: string,
  message: string
): GovernanceStatus {
  return {
    repoFullName,
    branch,
    status: 'unconfigured',
    branchProtectionConfigured: false,
    enforceAdmins: null,
    requirePullRequestReviews: null,
    dismissStaleReviews: null,
    requireUpToDateBranches: null,
    allowForcePushes: null,
    allowDeletions: null,
    requiredStatusChecks: [],
    missingRequiredChecks: [...REQUIRED_PROTECTION_CHECKS],
    drift: [message],
  };
}

function buildMissingBranchProtectionStatus(repoFullName: string, branch: string): GovernanceStatus {
  return {
    repoFullName,
    branch,
    status: 'drift',
    branchProtectionConfigured: false,
    enforceAdmins: false,
    requirePullRequestReviews: false,
    dismissStaleReviews: false,
    requireUpToDateBranches: false,
    allowForcePushes: true,
    allowDeletions: true,
    requiredStatusChecks: [],
    missingRequiredChecks: [...REQUIRED_PROTECTION_CHECKS],
    drift: [
      `Branch protection is not configured on ${branch}.`,
      `Missing required status checks: ${REQUIRED_PROTECTION_CHECKS.join(', ')}.`,
    ],
  };
}

function getRequiredStatusChecks(data: GithubProtectionResponse): string[] {
  return [
    ...new Set(
      [
        ...(Array.isArray(data.required_status_checks?.contexts) ? data.required_status_checks.contexts : []),
        ...(Array.isArray(data.required_status_checks?.checks)
          ? data.required_status_checks.checks
            .map((check) => check?.context)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
          : []),
      ],
    ),
  ];
}

function buildProtectedBranchGovernanceStatus(
  repoFullName: string,
  branch: string,
  data: GithubProtectionResponse
): GovernanceStatus {
  const requiredStatusChecks = getRequiredStatusChecks(data);
  const missingRequiredChecks = REQUIRED_PROTECTION_CHECKS.filter((check) => !requiredStatusChecks.includes(check));
  const enforceAdmins = data.enforce_admins?.enabled === true;
  const requirePullRequestReviews = !!data.required_pull_request_reviews;
  const dismissStaleReviews = data.required_pull_request_reviews?.dismiss_stale_reviews === true;
  const requireUpToDateBranches = data.required_status_checks?.strict === true;
  const allowForcePushes = data.allow_force_pushes?.enabled === true;
  const allowDeletions = data.allow_deletions?.enabled === true;

  const drift: string[] = [];
  if (!enforceAdmins) drift.push('Branch protection does not apply to administrators.');
  if (!requirePullRequestReviews) drift.push('Pull request reviews are not required before merge.');
  if (requirePullRequestReviews && !dismissStaleReviews) drift.push('Stale approvals are not dismissed on new commits.');
  if (!requireUpToDateBranches) drift.push('Branches do not have to be up to date before merge.');
  if (missingRequiredChecks.length > 0) drift.push(`Missing required status checks: ${missingRequiredChecks.join(', ')}.`);
  if (allowForcePushes) drift.push('Force pushes are still allowed on the protected branch.');
  if (allowDeletions) drift.push('Branch deletions are still allowed on the protected branch.');

  return {
    repoFullName,
    branch,
    status: drift.length > 0 ? 'drift' : 'healthy',
    branchProtectionConfigured: true,
    enforceAdmins,
    requirePullRequestReviews,
    dismissStaleReviews,
    requireUpToDateBranches,
    allowForcePushes,
    allowDeletions,
    requiredStatusChecks,
    missingRequiredChecks,
    drift,
  };
}

function getAxiosStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('response' in err)) {
    return undefined;
  }
  const response = (err as { response?: { status?: number } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

async function getGovernanceStatus(): Promise<GovernanceStatus> {
  const repoFullName = getSentinelGovernanceRepoFullName();
  const branch = await getDefaultBranch(repoFullName);
  const token = process.env['GITHUB_TOKEN']?.trim();

  if (!token) {
    return buildUnconfiguredGovernanceStatus(
      repoFullName,
      branch,
      'GITHUB_TOKEN is not configured, so GitHub branch protection cannot be verified.'
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${repoFullName}/branches/${encodeURIComponent(branch)}/protection`,
      { headers, timeout: 10000 }
    );
    return buildProtectedBranchGovernanceStatus(repoFullName, branch, (res.data ?? {}) as GithubProtectionResponse);
  } catch (err: unknown) {
    const status = getAxiosStatus(err);
    if (status === 404) {
      return buildMissingBranchProtectionStatus(repoFullName, branch);
    }

    const message = err instanceof Error ? err.message : 'unknown error';
    return buildUnconfiguredGovernanceStatus(
      repoFullName,
      branch,
      `GitHub branch protection check failed: ${message}`
    );
  }
}

export = { getGovernanceStatus };
