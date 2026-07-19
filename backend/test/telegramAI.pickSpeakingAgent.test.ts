import { pickSpeakingAgent } from '../src/telegramAI';

describe('pickSpeakingAgent', () => {
  // Regression test: the original regexes used /\b(analy|secur|debug|fail)\b/ —
  // a trailing \b right after a partial word stem requires a word boundary
  // immediately after it, but "analyze", "analysis", "security", "debugging",
  // "failed" all continue with more word characters there, so \b never matched
  // and these words silently fell through to the default agent.

  it('routes full words containing the "analy" stem to nvidia', () => {
    expect(pickSpeakingAgent('please analyze this repo')).toBe('nvidia');
    expect(pickSpeakingAgent('give me an analysis')).toBe('nvidia');
  });

  it('routes full words containing the "secur" stem to nvidia', () => {
    expect(pickSpeakingAgent('check security posture')).toBe('nvidia');
    expect(pickSpeakingAgent('is this secure?')).toBe('nvidia');
  });

  it('routes exact "audit"/"review"/"score"/"report" to nvidia', () => {
    expect(pickSpeakingAgent('run an audit')).toBe('nvidia');
    expect(pickSpeakingAgent('review this')).toBe('nvidia');
    expect(pickSpeakingAgent('what is the score')).toBe('nvidia');
    expect(pickSpeakingAgent('send report')).toBe('nvidia');
  });

  it('routes full words containing the "debug" stem to gemini', () => {
    expect(pickSpeakingAgent('start debugging now')).toBe('gemini');
    expect(pickSpeakingAgent('please debug this')).toBe('gemini');
  });

  it('routes full words containing the "fail" stem to gemini', () => {
    expect(pickSpeakingAgent('deploy failed overnight')).toBe('gemini');
    expect(pickSpeakingAgent('it keeps failing again')).toBe('gemini');
  });

  it('routes exact "broke"/"crash"/"log" to gemini', () => {
    expect(pickSpeakingAgent('it broke')).toBe('gemini');
    expect(pickSpeakingAgent('a crash happened')).toBe('gemini');
    expect(pickSpeakingAgent('check the log')).toBe('gemini');
  });

  it('code/fix/build words still route to qwen_coder and take priority over the analy/debug rules', () => {
    expect(pickSpeakingAgent('fix this bug')).toBe('qwen_coder');
    expect(pickSpeakingAgent('implement a function')).toBe('qwen_coder');
    // "fix this failing build" contains both a qwen_coder trigger ("fix", "build")
    // and a gemini trigger ("fail") — qwen_coder's regex is checked first, so it wins.
    expect(pickSpeakingAgent('fix this failing build')).toBe('qwen_coder');
  });

  it('fast/quick/simple/check/status still require whole-word match (unchanged behavior)', () => {
    expect(pickSpeakingAgent('quick check please')).toBe('deepseek');
    expect(pickSpeakingAgent('what is the status')).toBe('deepseek');
  });

  it('falls back to nvidia as the default speaker for unmatched text', () => {
    expect(pickSpeakingAgent('hello there')).toBe('nvidia');
  });
});
