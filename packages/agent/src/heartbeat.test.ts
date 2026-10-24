import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat, type Beat } from "./heartbeat";

/** Fake clock: vitest's fake timers drive both setInterval and Date.now, so the budget check sees the same time the ticks do. */
describe("heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const quiet = () => undefined;

  it("beats on the interval regardless of what the work is doing, and stops when told", async () => {
    const beat = vi.fn<Beat>(async () => "renewed");
    const stop = startHeartbeat({ beat, intervalMs: 30_000, budgetMs: 240_000, startedAt: Date.now(), onWarn: quiet });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(beat).toHaveBeenCalledTimes(3); // 30, 60, 90 s: four beats per 2-minute stale window once the one at 120 s lands
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beat).toHaveBeenCalledTimes(3);
  });

  it("stops at the run budget so a hung worker falls silent and the cron can rescue the run", async () => {
    const beat = vi.fn<Beat>(async () => "renewed");
    startHeartbeat({ beat, intervalMs: 30_000, budgetMs: 240_000, startedAt: Date.now(), onWarn: quiet });
    await vi.advanceTimersByTimeAsync(240_000);
    expect(beat).toHaveBeenCalledTimes(7); // 30 .. 210 s; the tick at 240 s sees the budget spent and stops
    await vi.advanceTimersByTimeAsync(600_000);
    expect(beat).toHaveBeenCalledTimes(7);
  });

  it("stops when the lease is lost and says so once", async () => {
    const beat = vi.fn<Beat>().mockResolvedValueOnce("renewed").mockResolvedValueOnce("lost").mockResolvedValue("renewed");
    const warn = vi.fn<(m: string) => void>();
    startHeartbeat({ beat, intervalMs: 1_000, budgetMs: 100_000, startedAt: Date.now(), onWarn: warn });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(beat).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/lease lost/);
  });

  it("a failed write is reported and the next beat still happens", async () => {
    const beat = vi.fn<Beat>().mockRejectedValueOnce(new Error("connection reset")).mockResolvedValue("renewed");
    const warn = vi.fn<(m: string) => void>();
    startHeartbeat({ beat, intervalMs: 1_000, budgetMs: 100_000, startedAt: Date.now(), onWarn: warn });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(beat).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/connection reset/);
  });

  it("a slow write is not stacked: one beat in flight at a time", async () => {
    let settle!: (v: "renewed") => void;
    const beat = vi.fn<Beat>(() => new Promise<"renewed" | "lost">((r) => { settle = r; }));
    startHeartbeat({ beat, intervalMs: 1_000, budgetMs: 100_000, startedAt: Date.now(), onWarn: quiet });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(beat).toHaveBeenCalledTimes(1);
    settle("renewed");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(beat).toHaveBeenCalledTimes(2);
  });
});
