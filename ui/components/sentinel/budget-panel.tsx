"use client";
import { motion } from "framer-motion";

export function BudgetPanel() {
  const used = 12.40;
  const total = 30;
  const pct = (used / total) * 100;

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
          <span className="text-s-gold font-semibold">${used.toFixed(2)}</span> / ${total}
        </span>
      </div>
      <div className="h-1 bg-s-border rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{
            background: pct > 80 ? "#EF4444" : pct > 60 ? "#F59E0B" : "#C8961C",
          }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[9px] font-mono text-s-dim">
        <span>{pct.toFixed(0)}% used</span>
        <span>${(total - used).toFixed(2)} remaining</span>
      </div>
    </div>
  );
}
