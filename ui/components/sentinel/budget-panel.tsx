"use client";
import { useEffect, useState } from "react";
import { MeterBar } from "./meter-bar";
import { scoreColor } from "@/lib/theme";

export function BudgetPanel() {
  const [used, setUsed]   = useState<number | null>(null);
  const [limit, setLimit] = useState(30);

  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (d && d.monthlyCost != null) {
          setUsed(d.monthlyCost);
          setLimit(d.budgetLimit ?? 30);
        }
      })
      .catch(() => {});
  }, []);

  const pct = used != null ? Math.min(100, (used / limit) * 100) : 0;
  // Budget bars invert the health-score palette: high usage is bad, so the
  // >80% (red) / >60% (amber) thresholds read the same way scoreColor's
  // >=80/>=60 thresholds do, just flipped for a "used up" rather than
  // "score" quantity — gold below the amber threshold, matching CostPilot's
  // brand accent.
  const barColor = pct > 80 ? scoreColor(20) : pct > 60 ? scoreColor(70) : "#C8961C";

  return (
    <div className="flex-shrink-0 p-3.5 border-t border-s-border bg-white/[0.01]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#C8961C" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span className="text-[9px] font-bold uppercase tracking-widest text-s-dim">CostPilot</span>
        </div>
        <span className="text-[9px] font-mono text-s-muted">
          {used != null ? (
            <><span className="text-s-gold font-semibold">${used.toFixed(2)}</span> / ${limit}</>
          ) : (
            <span className="text-[#444444]">loading…</span>
          )}
        </span>
      </div>
      <MeterBar pct={pct} color={barColor} delay={0.3} height={4} />
      <div className="flex justify-between mt-1.5 text-[9px] font-mono text-s-dim">
        <span>{used != null ? `${pct.toFixed(0)}% used` : "—"}</span>
        <span>{used != null ? `$${(limit - used).toFixed(2)} remaining` : ""}</span>
      </div>
    </div>
  );
}
