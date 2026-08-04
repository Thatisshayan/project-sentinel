import { scoreColor } from "./theme";

// AGENTS (fabricated agent roster), REPOS and FEED (fabricated repo/activity
// data) were removed — they were only ever used as a silent fallback or as a
// stand-in for real backend data, which is indistinguishable from real data
// and can paper over a genuine outage or a stale name that no longer matches
// live agent labels. Show an honest error/empty state in the UI instead of
// mock data (see agentColorForLabel in lib/theme.ts for deriving a color
// from a real backend-supplied agent label).

// Re-exported from lib/theme.ts (the single source for this threshold) so
// existing call sites don't all need updating at once.
export const healthColor = scoreColor;
