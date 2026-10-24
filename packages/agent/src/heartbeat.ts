/**
 * Lease renewal for one run: a timer that beats beside the work, whatever the graph is doing (design 2.1 step 10).
 * The cron (ops.redispatch) treats two minutes of silence as a dead worker and requeues the run. This timer is the only
 * thing that keeps a live run from looking dead; per-call deadlines bound the work, they do not prove liveness.
 *
 * It stops itself in two cases. At the run budget: a worker that is alive but stuck on an await that never settles
 * would otherwise beat forever and the run would never be rescued. When a beat reports the lease lost: the cron already
 * requeued the run and another worker claimed it, so this one goes quiet. The caller stops it when the run ends.
 */
export type Beat = () => Promise<"renewed" | "lost">;

export type HeartbeatOptions = {
  beat: Beat;
  intervalMs: number;
  budgetMs: number;
  startedAt: number;
  /** Reported, never thrown: a failed write must not take the run down, and a lost lease is the cron's verdict, not an error here. */
  onWarn: (message: string) => void;
};

export function startHeartbeat(o: HeartbeatOptions): () => void {
  let inFlight = false;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;
    if (Date.now() - o.startedAt >= o.budgetMs) {
      stop();
      return;
    }
    inFlight = true;
    try {
      if ((await o.beat()) === "lost") {
        o.onWarn("heartbeat: lease lost, another worker owns this run now; this one stops beating");
        stop();
      }
    } catch (e) {
      o.onWarn(`heartbeat: write failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, o.intervalMs);
  return stop;
}
