"use client";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { fadeInStagger, useSafeReducedMotion } from "@/lib/motion";

interface Stat { label: string; value: number; suffix: string; color: string; sub: string; }

export function StatStrip({ stats }: { stats: Stat[] }) {
  const reduced = useSafeReducedMotion();
  return (
    <div className="flex-shrink-0 flex border-b border-[#222222]">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          {...fadeInStagger(i, !!reduced)}
          className="relative flex-1 px-4 py-3 border-r border-[#222222] last:border-r-0 overflow-hidden"
        >
          {/* Top accent */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: s.color }} />
          {/* Subtle glow under accent */}
          <div className="absolute top-0 left-0 right-0 h-8 pointer-events-none"
            style={{ background: `linear-gradient(to bottom, ${s.color}0e, transparent)` }} />

          <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#555555] mb-1.5 relative">{s.label}</div>
          <div className="relative flex items-baseline gap-0.5 leading-none">
            <CountUp target={s.value} color={s.color} reduced={!!reduced} />
            {s.suffix && <span className="text-base font-bold font-mono" style={{ color: s.color }}>{s.suffix}</span>}
          </div>
          <div className="text-[9px] text-[#555555] mt-1.5 font-mono relative">{s.sub}</div>
        </motion.div>
      ))}
    </div>
  );
}

function CountUp({ target, color, reduced }: { target: number; color: string; reduced: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (reduced) {
      ref.current.textContent = String(target);
      return;
    }
    const start = Date.now();
    const dur = 900;
    const from = 0;
    let frameId: number;
    const frame = () => {
      const t = Math.min((Date.now() - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      if (ref.current) ref.current.textContent = String(Math.round(from + (target - from) * eased));
      if (t < 1) frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    // Cancel on cleanup — otherwise a pending frame from a prior run (e.g.
    // reduced flipping false→true mid-animation, which re-triggers this
    // effect) can fire once more and overwrite the value reduced motion
    // just set to its final state.
    return () => cancelAnimationFrame(frameId);
  }, [target, reduced]);

  return (
    <span ref={ref} className="text-[22px] font-extrabold font-mono tabular-nums" style={{ color }}>
      {target}
    </span>
  );
}
