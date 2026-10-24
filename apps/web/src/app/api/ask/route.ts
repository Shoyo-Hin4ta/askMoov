import { after } from "next/server";
import { z } from "zod";
import { PERSONA_KEYS, Pin, personaFor } from "@ask-moov/shared";
import { serverEnv } from "@/lib/env";
import { gitSha } from "@/lib/git-sha";
import { enqueueRun, monthTokens } from "@ask-moov/db";
import { pingWorker } from "@/lib/ping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Budget check, insert (idempotent on run_id), ping the worker, 202. Design doc 2.1 steps 1-3. */
const Body = z.object({
  run_id: z.uuid(),
  thread_id: z.string().min(1).max(100),
  persona: z.enum(PERSONA_KEYS),
  question: z.string().trim().min(1).max(1000),
  /** The clarification chip the user clicked, if any: pinned by id before the planner runs. */
  pin: Pin.optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request", issues: parsed.error.issues }, { status: 400 });
  const env = serverEnv();
  const used = await monthTokens();
  if (used >= env.monthlyTokenBudget) {
    return Response.json({ error: "monthly token budget exhausted", used, budget: env.monthlyTokenBudget }, { status: 429 });
  }
  const persona = personaFor(parsed.data.persona);
  const outcome = await enqueueRun({ id: parsed.data.run_id, thread_id: parsed.data.thread_id, persona, question: parsed.data.question, git_sha: gitSha(), pins: parsed.data.pin ? [parsed.data.pin] : [] });
  if (outcome === "inserted") after(() => pingWorker(parsed.data.run_id));
  return Response.json({ run_id: parsed.data.run_id, status: "queued", duplicate: outcome === "duplicate" }, { status: 202 });
}
