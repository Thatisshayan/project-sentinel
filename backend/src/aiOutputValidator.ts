import type { BrainDecision } from './types/brainDecision';
import type { AuditResult } from './types/auditResult';
import type { SprintProposal, SprintProposalTask } from './types/sprintRow';

function validateAuditOutput(parsed: unknown): AuditResult {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Audit output must be a JSON object');
  }
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p['tasks'])) {
    throw new Error('Audit output missing required field: tasks (array)');
  }
  if (p['tasks'].length === 0) {
    throw new Error('Audit output tasks array is empty');
  }
  for (let i = 0; i < p['tasks'].length; i++) {
    const t = p['tasks'][i] as Record<string, unknown>;
    if (!t || typeof t !== 'object') {
      throw new Error(`Task at index ${i} is not an object`);
    }
    if (!t['title'] && !t['taskNumber']) {
      throw new Error(`Task at index ${i} missing required field: title`);
    }
  }
  return p as unknown as AuditResult;
}

function validateSprintOutput(parsed: unknown): SprintProposal {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Sprint proposal must be a JSON object');
  }
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p['tasks'])) {
    throw new Error('Sprint proposal missing required field: tasks (array)');
  }
  if (p['tasks'].length === 0) {
    throw new Error('Sprint proposal returned no tasks');
  }
  for (let i = 0; i < p['tasks'].length; i++) {
    const t = p['tasks'][i] as Partial<SprintProposalTask>;
    if (!t || typeof t !== 'object') {
      throw new Error(`Sprint task at index ${i} is not an object`);
    }
    if (!t.taskTitle) {
      throw new Error(`Sprint task at index ${i} missing required field: taskTitle`);
    }
    if (!t.repoName && !t.repoFullName) {
      throw new Error(`Sprint task at index ${i} missing required field: repoName`);
    }
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    if (t.priority && !validPriorities.includes(t.priority)) {
      t.priority = 'medium';
    }
    const validComplexities = ['low', 'medium', 'high'];
    if (t.complexity && !validComplexities.includes(t.complexity)) {
      t.complexity = 'medium';
    }
  }
  return p as unknown as SprintProposal;
}

function validateBrainOutput(parsed: unknown): BrainDecision {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Brain decision must be a JSON object');
  }
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p['focus_repos'])) {
    throw new Error('Brain decision missing required field: focus_repos (array)');
  }
  const validActions = ['execute', 'audit', 'monitor'];
  if (!validActions.includes(p['action'] as string)) {
    throw new Error(`Brain decision has invalid action: "${p['action']}" — must be execute, audit, or monitor`);
  }
  if (typeof p['auto_execute'] !== 'boolean') {
    throw new Error('Brain decision missing required field: auto_execute (boolean)');
  }
  if (!p['reasoning'] || typeof p['reasoning'] !== 'string') {
    throw new Error('Brain decision missing required field: reasoning (string)');
  }
  if (!p['daily_goal'] || typeof p['daily_goal'] !== 'string') {
    throw new Error('Brain decision missing required field: daily_goal (string)');
  }
  // alerts/skip_repos are optional, but a malformed value (e.g. a bare
  // string instead of an array) would otherwise pass through untyped and
  // break downstream .forEach()/iteration after auto-execution and DB
  // persistence have already happened. Normalize rather than reject so a
  // model that gets the shape slightly wrong doesn't abort an otherwise
  // valid decision.
  const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (p['alerts'] !== undefined && !isStringArray(p['alerts'])) {
    p['alerts'] = [];
  }
  if (p['skip_repos'] !== undefined && !isStringArray(p['skip_repos'])) {
    p['skip_repos'] = [];
  }
  return p as unknown as BrainDecision;
}

export = { validateAuditOutput, validateSprintOutput, validateBrainOutput };
