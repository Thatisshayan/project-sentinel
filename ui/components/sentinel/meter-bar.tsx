"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { growWidth, useSafeReducedMotion } from "@/lib/motion";

interface MeterBarProps {
  pct: number;
  color: string;
  delay?: number;
  height?: number;
  trackClassName?: string;
  barClassName?: string;
}

// One shared animated width-fill bar. Replaces the near-identical
// hand-rolled versions in repo-row (health/security), budget-panel, and
// sprint-view's progress bar.
export function MeterBar({ pct, color, delay = 0, height = 3, trackClassName, barClassName }: MeterBarProps) {
  const reduced = useSafeReducedMotion();
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      className={cn("flex-1 rounded-full overflow-hidden bg-[#1e1e1e]", trackClassName)}
      style={{ height }}
    >
      <motion.div
        {...growWidth(clamped, !!reduced, delay)}
        className={cn("h-full rounded-full", barClassName)}
        style={{ background: color }}
      />
    </div>
  );
}
