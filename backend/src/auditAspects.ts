import logger from './logger';
import projectDb from './projectDb';

// D-027 item 5 (multi-aspect audit + scoring + rotation) — Shayan, 2026-07-29:
// "sentinel must do audit in different aspects also not only one!! ... no
// more than 3 sprint (10 task * 3) in each direction, then the direction
// must change for at least another 3 sprint." One triggerAudit() call
// already generates exactly 10 tasks — i.e. one sprint — so "3 sprints" is
// 3 consecutive audit cycles focused on the same aspect before rotating.
const ASPECTS = [
  'security',
  'functionality',
  'backend',
  'frontend',
  'ux_accessibility',
  'performance',
  'observability',
  'documentation',
  'testing',
  'database',
] as const;

type Aspect = typeof ASPECTS[number];

const SPRINTS_PER_ASPECT = 3;

function isValidAspect(a: unknown): a is Aspect {
  return typeof a === 'string' && (ASPECTS as readonly string[]).includes(a);
}

function nextAspect(current: Aspect): Aspect {
  const idx = ASPECTS.indexOf(current);
  return ASPECTS[(idx + 1) % ASPECTS.length]!;
}

interface AspectState {
  aspect: Aspect;
  sprintCount: number;
}

/**
 * The aspect the NEXT audit for this repo should focus on, and how many
 * sprints (audit cycles) it's already had within that aspect. Initializes a
 * repo that has never been audited under this system to the first aspect.
 */
async function getCurrentAspect(repoName: string): Promise<AspectState> {
  const stored = await projectDb.getAspectState(repoName).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Could not read aspect rotation state — defaulting to first aspect');
    return null;
  });

  if (stored && isValidAspect(stored.aspect)) {
    return { aspect: stored.aspect, sprintCount: stored.sprintCount };
  }

  const initial: AspectState = { aspect: ASPECTS[0], sprintCount: 0 };
  await projectDb.setAspectState(repoName, initial.aspect, initial.sprintCount).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Could not persist initial aspect rotation state');
  });
  return initial;
}

/**
 * Call once an audit cycle for `aspect` has actually completed (tasks
 * written). Increments the sprint counter and rotates to the next aspect
 * (resetting the counter) once SPRINTS_PER_ASPECT is reached.
 */
async function recordSprintCompleted(repoName: string, aspect: string): Promise<AspectState & { rotated: boolean }> {
  const current = isValidAspect(aspect) ? aspect : ASPECTS[0];
  const state = await getCurrentAspect(repoName);

  // Defensive: only advance the counter if this sprint was actually run
  // against the aspect the rotation state currently expects — a stale/
  // out-of-order call (e.g. a retried audit for an aspect that's since
  // rotated past) shouldn't silently corrupt the counter.
  if (state.aspect !== current) {
    logger.warn({ repoName, expected: state.aspect, got: current },
      'recordSprintCompleted called for a different aspect than the current rotation state — ignoring');
    return { ...state, rotated: false };
  }

  const newCount = state.sprintCount + 1;
  if (newCount >= SPRINTS_PER_ASPECT) {
    const rotatedTo = nextAspect(current);
    await projectDb.setAspectState(repoName, rotatedTo, 0).catch((err: any) => {
      logger.warn({ err: err.message, repoName }, 'Could not persist rotated aspect state');
    });
    logger.info({ repoName, from: current, to: rotatedTo }, 'Aspect rotation: 3 sprints complete, rotating focus');
    return { aspect: rotatedTo, sprintCount: 0, rotated: true };
  }

  await projectDb.setAspectState(repoName, current, newCount).catch((err: any) => {
    logger.warn({ err: err.message, repoName }, 'Could not persist aspect sprint count');
  });
  return { aspect: current, sprintCount: newCount, rotated: false };
}

export = { ASPECTS, SPRINTS_PER_ASPECT, isValidAspect, nextAspect, getCurrentAspect, recordSprintCompleted };
