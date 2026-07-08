import { getSecurityPortfolio, getPortfolio } from "@/lib/api";
import { SecurityView } from "@/components/sentinel/security-view";

export const revalidate = 60;

export default async function SecurityPage() {
  let scores: { repo: string; score: number; critical: number; high: number; medium: number; low: number }[] = [];
  let issues: { id: number; repo: string; title: string; cve: string | null; cvss: number | null; severity: string; status: string }[] = [];

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
    // Fallback mock
    scores = [
      { repo:"data-ingestion", score:44, critical:1, high:2, medium:3, low:1 },
      { repo:"ml-pipeline",    score:44, critical:0, high:2, medium:2, low:3 },
      { repo:"worker-queue",   score:57, critical:0, high:1, medium:2, low:2 },
      { repo:"api-gateway",    score:72, critical:0, high:0, medium:1, low:2 },
      { repo:"dashboard-ui",   score:79, critical:0, high:0, medium:1, low:1 },
      { repo:"billing-service",score:85, critical:0, high:0, medium:0, low:1 },
      { repo:"auth-service",   score:91, critical:0, high:0, medium:0, low:0 },
      { repo:"sentinel-core",  score:88, critical:0, high:0, medium:1, low:0 },
    ];
    issues = [
      { id:1, repo:"ml-pipeline",    title:"Prototype Pollution via lodash.merge",   cve:"CVE-2020-8203", cvss:7.4, severity:"high",     status:"open" },
      { id:2, repo:"ml-pipeline",    title:"ReDoS in path-to-regexp",                cve:"CVE-2024-45296",cvss:5.3, severity:"medium",    status:"open" },
      { id:3, repo:"data-ingestion", title:"Severity vuln in express-fileupload",    cve:"CVE-2020-7699", cvss:9.8, severity:"critical",  status:"open" },
      { id:4, repo:"data-ingestion", title:"Deprecated: node-uuid → uuid",           cve:null,            cvss:null,severity:"low",       status:"open" },
      { id:5, repo:"auth-service",   title:"JWT secret exposed in git history",      cve:null,            cvss:null,severity:"high",      status:"patched" },
      { id:6, repo:"worker-queue",   title:"SQL injection risk in raw query",        cve:null,            cvss:8.1, severity:"high",      status:"open" },
      { id:7, repo:"api-gateway",    title:"Missing rate limiting on /auth/login",   cve:null,            cvss:null,severity:"medium",    status:"review" },
    ];
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
    />
  );
}
