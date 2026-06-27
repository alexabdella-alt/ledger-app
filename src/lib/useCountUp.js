import React from "react";
import { prefersReducedMotion } from "./theme.js";

// useCountUp — animate a number from 0 → target on mount (the dashboard hero moment).
// Eases out (fast then settling) so big money figures land with confidence. Respects
// prefers-reduced-motion (jumps straight to the value) and re-runs if the target
// changes. Returns the current animated number; the caller formats it.
//
//   const n = useCountUp(cashOnHand, { duration: 1000 });
//   <span className="sc-mono">{fmtMoney(n)}</span>
export function useCountUp(target, { duration = 1000, decimals = 0 } = {}) {
  const end = Number(target) || 0;
  const [val, setVal] = React.useState(prefersReducedMotion() ? end : 0);
  const rafRef = React.useRef(0);
  const round = React.useCallback(
    (x) => { const p = Math.pow(10, decimals); return Math.round(x * p) / p; },
    [decimals]
  );

  React.useEffect(() => {
    if (prefersReducedMotion()) { setVal(end); return; }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const e = Math.min(1, (now - start) / duration);
      // easeOutExpo — confident, decelerating settle
      const k = e === 1 ? 1 : 1 - Math.pow(2, -10 * e);
      setVal(round(from + (end - from) * k));
      if (e < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration, round]);

  return val;
}
