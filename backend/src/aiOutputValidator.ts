import type { BrainDecision } from './types/brainDecision';

function validateAuditOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Audit output must be a JSON object');
  }
  if (!Array.isArray(parsed.tasks)) {
    throw new Error('Audit output missing required field: tasks (array)');
  }
  if (parsed.tasks.length === 0) {
    throw new Error('Audit output tasks array is empty');
  }
  for (let i = 0; i < parsed.tasks.length; i++) {
    const t = parsed.tasks[i];
    if (!t || typeof t !== 'object') {
      throw new Error(`Task at index ${i} is not an object`);
    }
    if (!t.title && !t.taskNumber) {
      throw new Error(`Task at index ${i} missing required field: title`);
    }
  }
  return parsed;
}

function validateSprintOutput(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Sprint proposal must be a JSON object');
  }
  if (!Array.isArray(parsed.tasks)) {
    throw new Error('Sprint proposal missing required field: tasks (array)');
  }
  if (parsed.tasks.length === 0) {
    throw new Error('Sprint proposal returned no tasks');
  }
  for (let i = 0; i < parsed.tasks.length; i++) {
    const t = parsed.tasks[i];
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
  return parsed;
}

function validateBrainOutput(parsed: any): BrainDecision {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Brain decision must be a JSON object');
  }
  if (!Array.isArray(parsed.focus_repos)) {
    throw new Error('Brain decision missing required field: focus_repos (array)');
  }
  const validActions = ['execute', 'audit', 'monitor'];
  if (!validActions.includes(parsed.action)) {
    throw new Error(`Brain decision has invalid action: "${parsed.action}" — must be execute, audit, or monitor`);
  }
  if (typeof parsed.auto_execute !== 'boolean') {
    throw new Error('Brain decision missing required field: auto_execute (boolean)');
  }
  if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
    throw new Error('Brain decision missing required field: reasoning (string)');
  }
  if (!parsed.daily_goal || typeof parsed.daily_goal !== 'string') {
    throw new Error('Brain decision missing required field: daily_goal (string)');
  }
  return parsed;
}

export = { validateAuditOutput, validateSprintOutput, validateBrainOutput };
