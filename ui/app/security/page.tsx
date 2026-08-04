import { getSecurityPortfolio, getPortfolio } from "@/lib/api";
import { SecurityView } from "@/components/sentinel/security-view";

// No `export const revalidate` here — see app/agents/page.tsx for why.

export default async function SecurityPage() {
  let scores: { repo: string; score: number; critical: number; high: number; medium: number; low: number }[] = [];
  let issues: { id: number; repo: string; title: string; cve: string | null; cvss: number | null; severity: string; status: string }[] = [];
  let loadError = false;

  try {
    const [sec, portfolio] = await Promise.all([getSecurityPortfolio(), getPortfolio()]);

    // Build score map — fall back to health*0.8 if no security scan yet
    const scoreMap = new Map(sec.scores.map(s => [s.repo_name, s]));

    scores = portfolio.repos.map(r => {
      const s = scoreMap.get(r.repo_name);
      return {
        repo:     r.repo_name,
        score:    s ? s.score : Math.round(parseFloat(String(r.health_score ?? 5)) * 8),
        critical: s?.critical_count ?? 0,
        high:     s?.high_count ?? 0,
        medium:   s?.medium_count ?? 0,
        low:      s?.low_count ?? 0,
      };
    }).sort((a, b) => a.score - b.score); // worst first

    issues = sec.issues.map(i => ({
      id:       i.id,
      repo:     i.repo_full_name?.split("/").pop() ?? "unknown",
      title:    i.title,
      cve:      (i as any).cve_id ?? null,
      cvss:     (i as any).cvss_score ?? null,
      severity: i.severity,
      status:   i.status,
    }));
  } catch {
    // Deliberately no mock fallback — a security dashboard showing fake CVE
    // data indistinguishable from real data on a backend outage is worse
    // than showing nothing. scores/issues stay empty; SecurityView renders
    // an explicit "couldn't load" state instead.
    loadError = true;
  }

  const openCount    = issues.filter(i => i.status === "open").length;
  const criticalCount= issues.filter(i => i.severity === "critical").length;
  const patchedCount = issues.filter(i => i.status === "patched").length;
  const avgScore     = scores.length ? Math.round(scores.reduce((s,r) => s + r.score, 0) / scores.length) : 0;

  return (
    <SecurityView
      scores={scores}
      issues={issues}
      summary={{ avgScore, openCount, criticalCount, patchedCount }}
      loadError={loadError}
    />
  );
}
