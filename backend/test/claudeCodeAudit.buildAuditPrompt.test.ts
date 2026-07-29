import claudeCodeAudit from '../src/claudeCodeAudit';
const { buildAuditPrompt, parseAuditOutput } = claudeCodeAudit;

describe('claudeCodeAudit.buildAuditPrompt (D-027 items 5 & 6: aspect focus + project memory injection)', () => {
  const basePayload = {
    repoFullName: 'org/tapcash', repoName: 'tapcash', projectName: 'Tapcash', commitSha: 'abc123',
  };

  test('includes an aspect focus instruction and aspect-scoped output fields when an aspect is given', () => {
    const prompt = buildAuditPrompt({ ...basePayload, aspect: 'security' });
    expect(prompt).toContain('FOCUS: This audit cycle is dedicated to the "security" aspect');
    expect(prompt).toContain('ALL 10 tasks must be about this aspect specifically');
    expect(prompt).toContain('"aspectHealthScore"');
    expect(prompt).toContain('"aspectEffectSummary"');
  });

  test('omits the aspect focus instruction when no aspect is given', () => {
    const prompt = buildAuditPrompt(basePayload);
    expect(prompt).not.toContain('FOCUS: This audit cycle is dedicated');
  });

  test('injects project memory text into the prompt when provided', () => {
    const memoryText = 'PROJECT MEMORY (recorded context for this repo...):\n- [Known false positive] the double openai/ prefix is correct';
    const prompt = buildAuditPrompt(basePayload, undefined, memoryText);
    expect(prompt).toContain(memoryText);
  });

  test('omits any project-memory section when no memory text is provided', () => {
    const prompt = buildAuditPrompt(basePayload);
    expect(prompt).not.toContain('PROJECT MEMORY');
  });
});

describe('claudeCodeAudit.parseAuditOutput — aspect fields (D-027 item 5)', () => {
  const validJson = (extra: object = {}) => JSON.stringify({
    repoName: 'tapcash', commitHash: 'abc', auditSummary: 's', overallHealthScore: 7,
    tasks: [{ taskNumber: 1, title: 'Fix x', priority: 'high', safeToAutoExecute: true }],
    ...extra,
  });

  test('defaults aspectHealthScore to overallHealthScore when the model omits it', () => {
    const result = parseAuditOutput(validJson());
    expect(result.aspectHealthScore).toBe(7);
    expect(result.aspectEffectSummary).toBe('');
  });

  test('clamps an out-of-range aspectHealthScore into 1-10', () => {
    const result = parseAuditOutput(validJson({ aspectHealthScore: 15 }));
    expect(result.aspectHealthScore).toBe(10);
  });

  test('passes through a valid aspectHealthScore and aspectEffectSummary', () => {
    const result = parseAuditOutput(validJson({ aspectHealthScore: 4, aspectEffectSummary: 'Users are at risk.' }));
    expect(result.aspectHealthScore).toBe(4);
    expect(result.aspectEffectSummary).toBe('Users are at risk.');
  });
});
