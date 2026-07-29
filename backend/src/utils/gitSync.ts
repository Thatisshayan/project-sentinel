import simpleGit from 'simple-git';
import logger from '../logger';

interface RebaseResult {
  rebased: boolean;
  conflicted: boolean;
  reason?: string;
}

/**
 * Attempts to rebase the current branch onto the latest tip of `origin/<baseBranch>`.
 * Used when a long-running Sentinel task/batch discovers the base branch moved
 * out from under it — previously taskBuilder.ts only warned about this risk
 * ("Merge Conflict Risk") and left the branch as-is; this actually resolves the
 * drift automatically when the rebase applies cleanly, and falls back to a
 * clean abort (branch untouched) when it can't, so a human resolving the
 * conflict manually isn't also stuck untangling a half-finished rebase.
 */
async function rebaseOntoBase(
  repoGit: ReturnType<typeof simpleGit>,
  baseBranch: string,
): Promise<RebaseResult> {
  try {
    await repoGit.rebase([`origin/${baseBranch}`]);
    return { rebased: true, conflicted: false };
  } catch (err: any) {
    try {
      await repoGit.rebase(['--abort']);
    } catch (abortErr: any) {
      logger.error(
        { err: abortErr instanceof Error ? (abortErr.stack ?? abortErr.message) : String(abortErr), baseBranch },
        'gitSync: rebase --abort itself failed — branch may be left in a mid-rebase state'
      );
    }
    return { rebased: false, conflicted: true, reason: err instanceof Error ? err.message : String(err) };
  }
}

export = { rebaseOntoBase };
