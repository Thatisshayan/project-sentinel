// Single source of truth for Sentinel's color system. Plain TS, no "use
// client" — tailwind.config.ts imports these same palettes so Tailwind's
// generated utilities and any JS-computed color (badges, meters, agent
// dots) can never drift apart the way the old per-page color maps did.

export const SENTINEL_TOKENS = {
  bg: "#0A0A0A",
  surface: "#111111",
  s2: "#161B22",
  border: "#222222",
  border2: "#2e2e2e",
  text: "#F5F5F5",
  muted: "#888888",
  dim: "#444444",
  ind: "#6366F1",
  gold: "#C8961C",
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444",
  cyan: "#00D4FF",
} as const;

// Canonical per-agent-slug colors — matches the backend's agent ids
// (nemotron, qwen-coder, gemini, llama, deepseek, qwen-max, qwen-turbo,
// qwen-dash). Used for exact-name lookups (lib/data.ts's AGENTS list,
// repo-row/sprint-view's assigned-agent dot).
export const AGENT_PALETTE = {
  nemotron: SENTINEL_TOKENS.ind,
  "qwen-coder": SENTINEL_TOKENS.amber,
  gemini: SENTINEL_TOKENS.green,
  llama: "#3B82F6",
  deepseek: "#8B5CF6",
  "qwen-max": "#EC4899",
  "qwen-turbo": "#14B8A6",
  "qwen-dash": "#F97316",
} as const;

export type AgentSlug = keyof typeof AGENT_PALETTE;

// Free-text label → color, for agent_label strings coming straight off the
// backend (e.g. "nvidia/nemotron-4-340b"), matched by substring. This
// reconciles the three near-duplicate copies that used to live in
// app/page.tsx, app/agents/page.tsx and app/agent-room/page.tsx.
const AGENT_LABEL_KEYS: [string, string][] = [
  ["nvidia", AGENT_PALETTE.nemotron],
  ["nemotron", AGENT_PALETTE.nemotron],
  ["hermes", AGENT_PALETTE.nemotron],
  // Model-specific Qwen keys must come before the generic "qwen" fallback —
  // substring matching returns on first hit, so "qwen" alone would swallow
  // qwen-max/qwen-turbo/qwen-dash labels before they reach their own color.
  ["qwen-max", AGENT_PALETTE["qwen-max"]],
  ["qwen-turbo", AGENT_PALETTE["qwen-turbo"]],
  ["qwen-dash", AGENT_PALETTE["qwen-dash"]],
  ["qwen", AGENT_PALETTE["qwen-coder"]],
  ["gemini", AGENT_PALETTE.gemini],
  ["llama", AGENT_PALETTE.llama],
  ["deepseek", AGENT_PALETTE.deepseek],
  ["aider", AGENT_PALETTE["qwen-turbo"]],
  ["dashboard", SENTINEL_TOKENS.gold],
];

export function agentColorForLabel(label: string | null | undefined): string {
  const l = label?.toLowerCase() ?? "";
  for (const [key, color] of AGENT_LABEL_KEYS) {
    if (l.includes(key)) return color;
  }
  return SENTINEL_TOKENS.muted;
}

export const SEVERITY_PALETTE: Record<string, string> = {
  critical: SENTINEL_TOKENS.red,
  high: SENTINEL_TOKENS.amber,
  medium: SENTINEL_TOKENS.ind,
  low: SENTINEL_TOKENS.muted,
};
export function severityColor(s: string): string {
  return SEVERITY_PALETTE[s] ?? SENTINEL_TOKENS.muted;
}

export const PRIORITY_PALETTE: Record<string, string> = {
  P0: SENTINEL_TOKENS.red,
  P1: SENTINEL_TOKENS.amber,
  P2: SENTINEL_TOKENS.muted,
};
export function priorityColor(p: string): string {
  return PRIORITY_PALETTE[p] ?? PRIORITY_PALETTE.P2;
}

export const STATUS_PALETTE: Record<string, string> = {
  working: SENTINEL_TOKENS.green,
  done: SENTINEL_TOKENS.green,
  completed: SENTINEL_TOKENS.green,
  idle: SENTINEL_TOKENS.muted,
  todo: SENTINEL_TOKENS.muted,
  failed: SENTINEL_TOKENS.red,
  blocked: SENTINEL_TOKENS.red,
  error: SENTINEL_TOKENS.red,
  paused: SENTINEL_TOKENS.amber,
  unconfigured: SENTINEL_TOKENS.amber,
};
export function statusColor(s: string): string {
  return STATUS_PALETTE[s] ?? SENTINEL_TOKENS.muted;
}

// Health/security score → color. Single copy of the >=80 green / >=60
// amber / else red threshold (previously duplicated in lib/data.ts's
// healthColor(), topbar.tsx and security-view.tsx's scoreColor()).
export function scoreColor(score: number): string {
  if (score >= 80) return SENTINEL_TOKENS.green;
  if (score >= 60) return SENTINEL_TOKENS.amber;
  return SENTINEL_TOKENS.red;
}

export function cvssColor(cvss: number): string {
  if (cvss >= 9) return SENTINEL_TOKENS.red;
  if (cvss >= 7) return SENTINEL_TOKENS.amber;
  return SENTINEL_TOKENS.green;
}

export const MEMORY_TYPE_PALETTE: Record<string, string> = {
  dismissed_finding: SENTINEL_TOKENS.muted,
  convention: SENTINEL_TOKENS.ind,
  decision: SENTINEL_TOKENS.gold,
  note: SENTINEL_TOKENS.cyan,
};
export function memoryTypeColor(t: string): string {
  return MEMORY_TYPE_PALETTE[t] ?? SENTINEL_TOKENS.muted;
}
