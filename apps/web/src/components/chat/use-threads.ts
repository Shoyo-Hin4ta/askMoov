import { useCallback, useEffect, useState } from "react";
import type { PersonaKey } from "@ask-moov/shared";
import { listThreads, type Thread } from "@/lib/client/api";

/** The persona's threads. A slow response for a previous persona is dropped so it cannot land after a switch. */
export function useThreads(persona: PersonaKey): { threads: Thread[]; refresh: () => Promise<void> } {
  const [threads, setThreads] = useState<Thread[]>([]);
  const refresh = useCallback(async () => setThreads(await listThreads(persona)), [persona]);
  useEffect(() => {
    let alive = true;
    void listThreads(persona).then((t) => { if (alive) setThreads(t); });
    return () => { alive = false; };
  }, [persona]);
  return { threads, refresh };
}
