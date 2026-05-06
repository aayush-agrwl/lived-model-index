"use client";

import { useEffect, useState } from "react";

/**
 * Reactive hook for OS-level dark-mode preference.
 *
 * Returns false during SSR and on first client paint, then flips to the
 * user's actual preference once `useEffect` runs. The brief light-mode
 * flash for dark-mode users on first paint is acceptable for the chart
 * components that consume this — recharts re-renders fast.
 *
 * Listens for live changes too: if the user toggles their OS theme while
 * the page is open, the hook re-fires and any dependent component re-
 * renders with the new palette.
 */
export function usePrefersDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDark;
}
