import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { serverEnv } from "@/lib/env";
import { claimRun } from "@ask-moov/db";
import { runClaimedRun } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function secretMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Verify, claim, answer 202, run the graph after the response (design doc 2.1 step 4). Callers: /api/ask, the worker itself, pg_cron. */
export async function POST(req: Request): Promise<Response> {
  if (!secretMatches(req.headers.get("x-worker-secret"), serverEnv().workerSecret)) return new Response("unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as { run_id?: unknown } | null;
  const runId = typeof body?.run_id === "string" ? body.run_id : null;
  if (!runId) return Response.json({ error: "run_id required" }, { status: 400 });
  const run = await claimRun(runId);
  if (!run) return Response.json({ claimed: false }, { status: 200 });
  after(() => runClaimedRun(run));
  return Response.json({ claimed: true, attempt: run.attempt }, { status: 202 });
}
