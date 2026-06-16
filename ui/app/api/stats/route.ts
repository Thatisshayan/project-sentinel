import { NextResponse } from "next/server";

export const revalidate = 15;

export async function GET() {
  const base = process.env.SENTINEL_API_URL;
  const key  = process.env.SENTINEL_UI_KEY;
  if (!base) return NextResponse.json({ error: "no backend" }, { status: 503 });

  try {
    const headers = { ...(key ? { "x-sentinel-key": key } : {}) };
    const [portfolioRes, securityRes] = await Promise.all([
      fetch(`${base}/api/portfolio`, { headers, next: { revalidate: 15 } }),
      fetch(`${base}/api/security/portfolio`, { headers, next: { revalidate: 15 } }).catch(() => null),
    ]);
    if (!portfolioRes.ok) throw new Error(`${portfolioRes.status}`);
    const data = await portfolioRes.json();
    const repos: any[] = data.repos ?? [];
    const agents: any[] = data.agents ?? [];
    const avgHealth = repos.length
      ? Math.round(repos.reduce((s: number, r: any) => s + parseFloat(String(r.health_score ?? 0)) * 10, 0) / repos.length)
      : 0;

    let securityIssueCount = 0;
    if (securityRes && securityRes.ok) {
      const secData = await securityRes.json().catch(() => null);
      securityIssueCount = secData?.issues?.length ?? 0;
    }

    return NextResponse.json({
      avgHealth:    Math.min(100, avgHealth),
      workingCount: agents.filter((a: any) => a.status === "working").length,
      repoCount:    repos.length,
      agentCount:   agents.length,
      securityIssueCount,
      monthlyCost:  data.monthlyCost ?? 0,
      budgetLimit:  30,
    });
  } catch {
    return NextResponse.json({ error: "upstream error" }, { status: 502 });
  }
}
