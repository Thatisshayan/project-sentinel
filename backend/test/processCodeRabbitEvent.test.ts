const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
const createAuditCycleMock    = jest.fn();
const updateAuditCycleMock    = jest.fn().mockResolvedValue(undefined);
const createAuditTaskMock     = jest.fn().mockResolvedValue({ id: 1 });

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));
jest.mock('../src/auditDb', () => ({
  createAuditCycle: (...a: any[]) => createAuditCycleMock(...a),
  updateAuditCycle: (...a: any[]) => updateAuditCycleMock(...a),
  createAuditTask:  (...a: any[]) => createAuditTaskMock(...a),
}));

import {
  processCodeRabbitEvent,
  normalizePayload,
  buildSummaryText,
} from '../src/webhook/processCodeRabbitEvent';

describe('processCodeRabbitEvent — payload normalization', () => {
  it('extracts repo/commit/findings from a GitHub-style PR review payload', () => {
    const payload = {
      repository: { full_name: 'thatisshayan/costpilot' },
      pull_request: { html_url: 'https://github.com/x/pr/1', number: 1, head: { sha: 'abc1234' } },
      review: {
        comments: [
          { file: 'src/index.ts', severity: 'critical', message: 'SQL injection risk' },
          { file: 'src/util.ts', severity: 'low', message: 'Unused import' },
        ],
      },
    };
    const normalized = normalizePayload(payload);
    expect(normalized).not.toBeNull();
    expect(normalized!.repoFullName).toBe('thatisshayan/costpilot');
    expect(normalized!.repoName).toBe('costpilot');
    expect(normalized!.commitSha).toBe('abc1234');
    expect(normalized!.findings).toHaveLength(2);
    expect(normalized!.findings[0].priority).toBe('critical');
  });

  it('returns null when the payload has no identifiable repo', () => {
    expect(normalizePayload({})).toBeNull();
    expect(normalizePayload({ findings: [] })).toBeNull();
  });

  it('defaults an unrecognized/missing severity to medium rather than crashing', () => {
    const normalized = normalizePayload({
      repository: { full_name: 'a/b' },
      findings: [{ message: 'something', severity: 'nonsense' }, { message: 'no severity at all' }],
    });
    expect(normalized!.findings.every(f => f.priority === 'medium')).toBe(true);
  });
});

describe('processCodeRabbitEvent — summary formatting', () => {
  it('counts findings by severity and lists the top 5 by priority', () => {
    const findings = [
      { title: 'a', description: '', priority: 'low' as const, category: 'x', affectedFiles: [] },
      { title: 'b', description: '', priority: 'critical' as const, category: 'x', affectedFiles: [] },
    ];
    const text = buildSummaryText('costpilot', findings, 'https://pr-link');
    expect(text).toContain('Critical: 1');
    expect(text).toContain('Low: 1');
    expect(text).toContain('https://pr-link');
  });

  it('handles zero findings without error', () => {
    const text = buildSummaryText('costpilot', [], undefined);
    expect(text).toContain('No findings.');
  });
});

describe('processCodeRabbitEvent — end to end (mocked DB/Telegram)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an audit cycle, one task per finding tagged source=coderabbit, and posts a summary', async () => {
    createAuditCycleMock.mockResolvedValue({ id: 42 });
    await processCodeRabbitEvent({
      repository: { full_name: 'thatisshayan/costpilot' },
      pull_request: { html_url: 'https://pr', number: 5, head: { sha: 'deadbee' } },
      review: { comments: [{ file: 'a.ts', severity: 'high', message: 'issue' }] },
    });

    expect(createAuditCycleMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'thatisshayan/costpilot', commitSha: 'deadbee' })
    );
    expect(createAuditTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ auditCycleId: 42, source: 'coderabbit', safeToAutoExecute: false })
    );
    expect(sendTelegramMessageMock).toHaveBeenCalled();
  });

  it('does nothing and does not throw when the audit cycle already exists (createAuditCycle returns null)', async () => {
    createAuditCycleMock.mockResolvedValue(null);
    await expect(processCodeRabbitEvent({
      repository: { full_name: 'thatisshayan/costpilot' },
      pull_request: { head: { sha: 'dup' } },
      review: { comments: [] },
    })).resolves.toBeUndefined();
    expect(createAuditTaskMock).not.toHaveBeenCalled();
  });

  it('does not throw on an unrecognized payload shape', async () => {
    await expect(processCodeRabbitEvent({ garbage: true })).resolves.toBeUndefined();
    expect(createAuditCycleMock).not.toHaveBeenCalled();
  });
});
