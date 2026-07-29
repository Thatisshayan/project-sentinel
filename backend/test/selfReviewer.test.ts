const axiosGetMock  = jest.fn();
const axiosPostMock = jest.fn();
jest.mock('axios', () => ({
  get:  (...a: any[]) => axiosGetMock(...a),
  post: (...a: any[]) => axiosPostMock(...a),
}));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(true);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

jest.mock('../src/utils/safeFire', () => ({
  safeFire: (p: any) => (typeof p === 'function' ? p() : p),
  fireAndForget: (_p: any) => undefined,
}));

const getAuditCycleMock          = jest.fn();
const createAuditCycleMock       = jest.fn();
const createAuditTaskMock        = jest.fn();
const getNextTaskNumberForCycleMock = jest.fn();
jest.mock('../src/auditDb', () => ({
  getAuditCycle:              (...a: any[]) => getAuditCycleMock(...a),
  createAuditCycle:           (...a: any[]) => createAuditCycleMock(...a),
  createAuditTask:            (...a: any[]) => createAuditTaskMock(...a),
  getNextTaskNumberForCycle:  (...a: any[]) => getNextTaskNumberForCycleMock(...a),
}));

const getMemoryForPromptMock = jest.fn().mockResolvedValue('');
jest.mock('../src/projectMemory', () => ({
  getMemoryForPrompt: (...a: any[]) => getMemoryForPromptMock(...a),
}));

import selfReviewer from '../src/selfReviewer';
const { reviewPrDiff } = selfReviewer;

describe('selfReviewer.reviewPrDiff (D-027 item 4: self-review fallback)', () => {
  const baseParams = {
    repoFullName: 'org/costpilot', repoName: 'costpilot',
    prNumber: 12, prUrl: 'https://github.com/org/costpilot/pull/12', topicId: 'topic-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['NVIDIA_API_KEY'] = 'test-key';
    process.env['GITHUB_TOKEN']   = 'test-token';
    getAuditCycleMock.mockResolvedValue(null);
    createAuditCycleMock.mockResolvedValue({ id: 'cycle-1' });
    getNextTaskNumberForCycleMock.mockResolvedValue(1);
    createAuditTaskMock.mockResolvedValue({ id: 't1' });
  });

  afterEach(() => {
    delete process.env['NVIDIA_API_KEY'];
    delete process.env['GITHUB_TOKEN'];
  });

  test('skips entirely when NVIDIA_API_KEY is not configured', async () => {
    delete process.env['NVIDIA_API_KEY'];
    const result = await reviewPrDiff(baseParams);
    expect(result).toEqual({ ran: false, findingsCreated: 0, reason: 'no_review_model_configured' });
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  test('fetches the diff with the .diff media type and creates a task per finding', async () => {
    axiosGetMock.mockResolvedValue({ data: 'diff --git a/foo.ts b/foo.ts\n+bug here' });
    axiosPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({
        findings: [
          { title: 'Off-by-one in loop', description: 'Loop bound is wrong', severity: 'high', path: 'foo.ts' },
          { title: 'Unused import', description: 'Dead code', severity: 'low' },
        ],
      }) } }] },
    });

    const result = await reviewPrDiff(baseParams);

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/costpilot/pulls/12',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github.v3.diff' }) })
    );
    expect(createAuditTaskMock).toHaveBeenCalledTimes(2);
    expect(createAuditTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Off-by-one in loop', priority: 'high', affectedFiles: ['foo.ts'],
      source: 'self_review', safeToAutoExecute: false,
    }));
    expect(result).toEqual({ ran: true, findingsCreated: 2 });
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessageMock.mock.calls[0][0]).toContain('Sentinel self-review');
  });

  test('reports a clean diff (no findings) without creating any task', async () => {
    axiosGetMock.mockResolvedValue({ data: 'diff --git a/foo.ts b/foo.ts\n+fine' });
    axiosPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ findings: [] }) } }] },
    });

    const result = await reviewPrDiff(baseParams);

    expect(createAuditTaskMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ran: true, findingsCreated: 0 });
    expect(sendTelegramMessageMock.mock.calls[0][0]).toContain('No issues found');
  });

  test('strips <think> reasoning blocks before parsing JSON', async () => {
    axiosGetMock.mockResolvedValue({ data: 'diff --git a/foo.ts b/foo.ts\n+bug' });
    axiosPostMock.mockResolvedValue({
      data: { choices: [{ message: { content:
        '<think>let me consider { this }</think>' + JSON.stringify({ findings: [
          { title: 'Real finding', description: 'x', severity: 'medium' },
        ] })
      } }] },
    });

    const result = await reviewPrDiff(baseParams);
    expect(result.findingsCreated).toBe(1);
  });

  test('fails closed (does not throw, does not create tasks) when the diff fetch fails', async () => {
    axiosGetMock.mockRejectedValue(new Error('404'));
    const result = await reviewPrDiff(baseParams);
    expect(result).toEqual({ ran: false, findingsCreated: 0, reason: 'diff_fetch_failed' });
    expect(createAuditTaskMock).not.toHaveBeenCalled();
  });

  test('fails closed when the model returns unparseable output', async () => {
    axiosGetMock.mockResolvedValue({ data: 'diff --git a/foo.ts b/foo.ts\n+bug' });
    axiosPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'not json at all' } }] } });
    const result = await reviewPrDiff(baseParams);
    expect(result).toEqual({ ran: false, findingsCreated: 0, reason: 'model_call_failed' });
  });

  test('D-027 item 6: injects project memory into the review prompt sent to the model', async () => {
    getMemoryForPromptMock.mockResolvedValue('PROJECT MEMORY:\n- [convention] always use safeFire for Telegram sends');
    axiosGetMock.mockResolvedValue({ data: 'diff --git a/foo.ts b/foo.ts\n+bug' });
    axiosPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ findings: [] }) } }] },
    });

    await reviewPrDiff(baseParams);

    expect(getMemoryForPromptMock).toHaveBeenCalledWith('org/costpilot');
    const sentPrompt = axiosPostMock.mock.calls[0][1].messages[0].content;
    expect(sentPrompt).toContain('always use safeFire for Telegram sends');
  });

  test('truncates an oversized diff before sending it to the model', async () => {
    axiosGetMock.mockResolvedValue({ data: 'x'.repeat(20000) });
    axiosPostMock.mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ findings: [] }) } }] },
    });

    await reviewPrDiff(baseParams);

    const sentPrompt = axiosPostMock.mock.calls[0][1].messages[0].content;
    expect(sentPrompt).toContain('[diff truncated]');
    expect(sentPrompt.length).toBeLessThan(20000);
  });
});
