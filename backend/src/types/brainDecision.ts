// Shape of sentinelBrain.ts's LLM-produced strategic decision, once
// validateBrainOutput() (aiOutputValidator.ts) has confirmed the required
// fields are present and correctly typed. See BRAIN_SYSTEM in
// sentinelBrain.ts for the prompt that specifies this exact JSON shape.

export interface BrainDecision {
  focus_repos: string[];
  action: 'execute' | 'audit' | 'monitor';
  auto_execute: boolean;
  reasoning: string;
  daily_goal: string;
  alerts?: string[];
  skip_repos?: string[];
}
