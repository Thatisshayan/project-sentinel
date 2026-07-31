// Shared framer-motion presets. Consolidates the half-dozen near-duplicate
// stagger/grow animations that used to be retyped per component (repo-row,
// stat-strip, agent-feed, agents-view, sprint-view each had their own delay
// multiplier and duration) into one vocabulary, and is the app's single
// reduced-motion gate — every entrance/bar-fill animation collapses to an
// instant transition when `reduced` is true instead of being ignored.

import { useEffect, useState } from "react";
import { useReducedMotion, type Transition } from "framer-motion";

// framer-motion's useReducedMotion() reads window.matchMedia synchronously
// on the client's very first render — there's no SSR-safe null state — so
// for any visitor with prefers-reduced-motion enabled, that first client
// render (the one React hydrates against) already disagrees with the
// server's implicit "not reduced" markup, producing a hydration mismatch.
// Gating behind a post-mount flag keeps the first client render identical
// to the server; the real preference takes effect a moment later.
export function useSafeReducedMotion(): boolean {
  const prefersReduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!prefersReduced;
}

const STAGGER_STEP = 0.03;
const FADE_DURATION = 0.2;
const GROW_DURATION = 0.7;

export function fadeInStagger(index: number, reduced: boolean, axis: "x" | "y" = "y") {
  const offset = axis === "y" ? { y: 6 } : { x: 8 };
  const rest = axis === "y" ? { y: 0 } : { x: 0 };
  return {
    initial: reduced ? { opacity: 1, ...rest } : { opacity: 0, ...offset },
    animate: { opacity: 1, ...rest },
    transition: reduced
      ? { duration: 0 }
      : ({ delay: index * STAGGER_STEP, duration: FADE_DURATION, ease: "easeOut" } as Transition),
  };
}

export function growWidth(pct: number, reduced: boolean, delay = 0) {
  return {
    initial: reduced ? { width: `${pct}%` } : { width: 0 },
    animate: { width: `${pct}%` },
    transition: reduced
      ? { duration: 0 }
      : ({ delay, duration: GROW_DURATION, ease: "easeOut" } as Transition),
  };
}

export function growHeight(pct: number, reduced: boolean, delay = 0) {
  return {
    initial: reduced ? { height: `${pct}%` } : { height: 0 },
    animate: { height: `${pct}%` },
    transition: reduced
      ? { duration: 0 }
      : ({ delay, duration: GROW_DURATION, ease: "easeOut" } as Transition),
  };
}
