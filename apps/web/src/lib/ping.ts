import { serverEnv } from "./env";

/** The fast path: one POST to the worker right after a run is queued. The pg_cron re-dispatch is the guarantee. */
export async function pingWorker(runId: string): Promise<void> {
  const { appUrl, workerSecret } = serverEnv();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5_000);
  try {
    await fetch(`${appUrl}/api/worker`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-secret": workerSecret },
      body: JSON.stringify({ run_id: runId }),
      signal: ctl.signal,
    });
  } catch {
    // nothing to do: ops.redispatch() picks the run up within a minute
  } finally {
    clearTimeout(timer);
  }
}
