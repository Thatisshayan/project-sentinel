// Shared display-mapping helpers. Consolidates the mapBuild/mapPriority/
// relativeTime functions that used to be redefined nearly identically in
// app/page.tsx, app/repos/page.tsx and app/sprint/page.tsx.

export type BuildStatus = "pass" | "fail" | "pending";
export type Priority = "P0" | "P1" | "P2";

export function mapBuild(s: string | null | undefined): BuildStatus {
  if (s === "passing" || s === "passed" || s === "pass" || s === "success") return "pass";
  if (s === "failed" || s === "fail" || s === "failure") return "fail";
  return "pending";
}

export function mapPriority(s: string | null | undefined): Priority {
  if (s === "critical") return "P0";
  if (s === "high") return "P1";
  return "P2";
}

export function mapTaskStatus(s: string | null | undefined): "working" | "done" | "blocked" | "todo" {
  if (s === "completed" || s === "done") return "done";
  if (s === "in_progress" || s === "working") return "working";
  if (s === "failed" || s === "blocked") return "blocked";
  return "todo";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
