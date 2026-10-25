import { useCallback, useEffect, useState } from "react";
import type { PersonaKey } from "@ask-moov/shared";
import { listThreads, type Thread } from "@/lib/client/api";

/**
 * The persona's threads. `loading` is true from a persona change until that persona's first fetch settles, so the list can
 * say "Loading" rather than "No threads yet"; it is derived from which persona last settled, so the effect sets no state
 * synchronously. A slow response for a previous persona is dropped so it cannot land after a switch.
 */
export function useThreads(persona: PersonaKey): { threads: Thread[]; loading: boolean; refresh: () => Promise<void> } {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [settledFor, setSettledFor] = useState<PersonaKey | null>(null);
  const refresh = useCallback(async () => setThreads(await listThreads(persona)), [persona]);
  useEffect(() => {
    let alive = true;
    listThreads(persona)
      .then((t) => { if (alive) setThreads(t); }, () => undefined)
      .finally(() => { if (alive) setSettledFor(persona); });
    return () => { alive = false; };
  }, [persona]);
  const loading = settledFor !== persona;
  // Never show the previous persona's rows under the new persona: an empty list plus `loading` renders "Loading threads".
  return { threads: loading ? [] : threads, loading, refresh };
}
