"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { callAction } from "@/lib/actions";
import { scoreColor, cvssColor, severityColor } from "@/lib/theme";
import { ColorBadge } from "./color-badge";
import { PagePanel } from "./page-panel";
import { ApiErrorBanner, EmptyNote } from "./empty-state";

function CvssBadge({ cvss }: { cvss: number | null }) {
  if (cvss == null) return <span className="text-s-dim text-[10px] font-mono">—</span>;
  return <ColorBadge color={cvssColor(cvss)} size="sm">{cvss}</ColorBadge>;
}

interface Props {
  scores: { repo: string; score: number; critical: number; high: number; medium: number; low: number }[];
  issues: { id: number; repo: string; title: string; cve: string | null; cvss: number | null; severity: string; status: string }[];
  summary: { avgScore: number; openCount: number; criticalCount: number; patchedCount: number };
  loadError?: boolean;
}

export function SecurityView({ scores, issues, summary, loadError }: Props) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [patching, setPatching] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      await callAction("/api/system/security-scan");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Security scan failed");
    }
    setScanning(false);
  };

  const patch = async (id: number) => {
    setPatching(id);
    setError(null);
    try {
      await callAction(`/api/security/issue/${id}/patch`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Patch failed");
    }
    setPatching(null);
  };

  return (
    <div className="p-5 space-y-5 overflow-y-auto flex-1">
      {loadError && <ApiErrorBanner label="security" />}

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label:"Avg Security", value: summary.avgScore,    color: scoreColor(summary.avgScore) },
          { label:"Open Issues",  value: summary.openCount,   color:"#EF4444" },
          { label:"Critical",     value: summary.criticalCount,color:"#EF4444" },
          { label:"Patched",      value: summary.patchedCount, color:"#22C55E" },
        ].map(s => (
          <div key={s.label} className="border border-s-border rounded-lg px-3.5 py-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: s.color }} />
            <div className="text-[9px] uppercase tracking-widest text-s-dim mb-1">{s.label}</div>
            <div className="text-2xl font-extrabold font-mono" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="text-[10px] text-s-red px-1">{error}</div>
      )}

      {/* Repo grid */}
      <PagePanel
        title="Portfolio Security"
        action={
          <button
            onClick={runScan}
            disabled={scanning}
            className="text-[10px] px-3 py-1 rounded border border-s-ind/40 text-s-ind hover:bg-s-ind/10 transition-all disabled:opacity-40"
          >
            {scanning ? "Scanning…" : "Run All Scans"}
          </button>
        }
      >
        {scores.length > 0 ? (
          <div className="grid grid-cols-3 gap-px bg-s-border">
            {scores.map(r => {
              const color = scoreColor(r.score);
              const total = r.critical + r.high + r.medium + r.low;
              return (
                <div key={r.repo} className="bg-s-bg p-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium font-mono truncate">{r.repo}</span>
                    <span className="text-sm font-extrabold font-mono ml-2 flex-shrink-0" style={{ color }}>{r.score}</span>
                  </div>
                  <div className="h-1 bg-s-border rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full transition-all" style={{ width:`${r.score}%`, background:color }} />
                  </div>
                  {total > 0 ? (
                    <div className="flex gap-2 text-[9px] font-mono">
                      {r.critical > 0 && <span className="text-s-red">{r.critical} crit</span>}
                      {r.high > 0 && <span className="text-s-amber">{r.high} high</span>}
                      {r.medium > 0 && <span className="text-s-ind">{r.medium} med</span>}
                      {r.low > 0 && <span className="text-s-dim">{r.low} low</span>}
                    </div>
                  ) : (
                    <span className="text-[9px] text-s-dim font-mono">no issues</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyNote>
            {loadError ? "No data — backend unreachable." : "No security data yet — run a scan to get started."}
          </EmptyNote>
        )}
      </PagePanel>

      {/* Issues table */}
      {issues.length > 0 && (
        <PagePanel
          title="Open Issues"
          action={
            <button
              onClick={() => issues.filter(i => i.status === "open").forEach(i => patch(i.id))}
              className="text-[10px] px-3 py-1 rounded border border-s-green/40 text-s-green hover:bg-s-green/10 transition-all"
            >
              Patch All Safe
            </button>
          }
        >
          {issues.map(issue => (
            <div key={issue.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-s-border last:border-b-0 hover:bg-white/[0.02]">
              <ColorBadge color={severityColor(issue.severity)} size="xs" uppercase>{issue.severity}</ColorBadge>
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate">{issue.title}</div>
                <div className="text-[10px] text-s-muted font-mono">{issue.repo}</div>
              </div>
              {issue.cve && <span className="text-[9px] font-mono text-s-dim flex-shrink-0">{issue.cve}</span>}
              <CvssBadge cvss={issue.cvss} />
              <span className={`text-[9px] font-mono flex-shrink-0 ${
                issue.status === "patched" ? "text-s-green" :
                issue.status === "review"  ? "text-s-amber" : "text-s-muted"
              }`}>{issue.status}</span>
              {issue.status === "open" && (
                <button
                  onClick={() => patch(issue.id)}
                  disabled={patching === issue.id}
                  className="text-[10px] px-2 py-0.5 rounded border border-s-green/30 text-s-green hover:bg-s-green/10 transition-all disabled:opacity-40 flex-shrink-0"
                >
                  {patching === issue.id ? "…" : "Patch"}
                </button>
              )}
            </div>
          ))}
        </PagePanel>
      )}
    </div>
  );
}
