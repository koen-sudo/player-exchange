"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page every few seconds while something is pending, for at most `maxSeconds`. */
export function AutoRefresh({ everyMs = 2_000, maxSeconds = 90 }: { everyMs?: number; maxSeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > maxSeconds * 1000) return clearInterval(t);
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, maxSeconds]);
  return null;
}
