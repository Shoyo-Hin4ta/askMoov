"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While a run is queued or running, re-render the server page every two seconds. Rounds appear once they finish. */
export function AutoRefresh({ active, everyMs = 2000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  if (!active) return null;
  return <p className="text-xs text-ink-3" aria-live="polite">This run is still in flight; the page refreshes every two seconds. Rounds appear after they finish.</p>;
}
