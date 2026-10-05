import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export const prefersReducedMotion = () => {
  try { return window.matchMedia(QUERY).matches; } catch { return false; }
};

/** True when the person has asked their device for less motion. Every animation in the app stands down for it. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(QUERY); } catch { return; }
    const h = () => setReduced(mq.matches);
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);
  return reduced;
}

