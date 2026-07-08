const { validateAuditOutput, validateSprintOutput, validateBrainOutput } = require('../src/aiOutputValidator');

describe('validateAuditOutput', () => {
  it('passes valid audit output', () => {
    const data = { tasks: [{ taskNumber: 1, title: 'Fix thing', priority: 'high' }] };
    expect(() => validateAuditOutput(data)).not.toThrow();
  });

  it('throws when tasks is missing', () => {
    expect(() => validateAuditOutput({ summary: 'ok' })).toThrow('tasks (array)');
  });

  it('throws when tasks is empty', () => {
    expect(() => validateAuditOutput({ tasks: [] })).toThrow('empty');
  });

  it('throws for non-object input', () => {
    expect(() => validateAuditOutput('bad')).toThrow('JSON object');
  });
});

describe('validateSprintOutput', () => {
  const validTask = { taskTitle: 'Add login', repoName: 'myapp', priority: 'high', complexity: 'medium' };

  it('passes valid sprint proposal', () => {
    const data = { tasks: [validTask], weekStart: '2026-06-17', weekEnd: '2026-06-21' };
    expect(() => validateSprintOutput(data)).not.toThrow();
  });

  it('throws when tasks is missing', () => {
    expect(() => validateSprintOutput({ summary: 'ok' })).toThrow('tasks (array)');
  });

  it('throws when tasks array is empty', () => {
    expect(() => validateSprintOutput({ tasks: [] })).toThrow('no tasks');
  });

  it('throws when task missing taskTitle', () => {
    expect(() => validateSprintOutput({ tasks: [{ repoName: 'x' }] })).toThrow('taskTitle');
  });

  it('normalises invalid priority to medium', () => {
    const data = { tasks: [{ ...validTask, priority: 'urgent' }] };
    validateSprintOutput(data);
    expect(data.tasks[0].priority).toBe('medium');
  });
});

describe('validateBrainOutput', () => {
  const validBrain = {
    focus_repos: ['tapcash'],
    action: 'execute',
    auto_execute: true,
    reasoning: 'Tapcash is broken.',
    daily_goal: 'Fix the CI pipeline',
  };

  it('passes valid brain decision', () => {
    expect(() => validateBrainOutput(validBrain)).not.toThrow();
  });

  it('throws when focus_repos is missing', () => {
    const bad = { ...validBrain };
    delete bad.focus_repos;
    expect(() => validateBrainOutput(bad)).toThrow('focus_repos');
  });

  it('throws on invalid action', () => {
    expect(() => validateBrainOutput({ ...validBrain, action: 'delete-everything' })).toThrow('invalid action');
  });

  it('throws when auto_execute is not boolean', () => {
    expect(() => validateBrainOutput({ ...validBrain, auto_execute: 'yes' })).toThrow('auto_execute (boolean)');
  });

  it('throws when reasoning is missing', () => {
    const bad = { ...validBrain };
    delete bad.reasoning;
    expect(() => validateBrainOutput(bad)).toThrow('reasoning');
  });
});
