import { PERSONA_KEYS, PERSONAS, type PersonaKey } from "@ask-moov/shared";
import { listThreadRuns } from "@ask-moov/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The runs of one thread, oldest first, so reopening a thread can show its past answers. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!id || id.length > 100) return Response.json({ error: "bad thread id" }, { status: 400 });
  const key = new URL(req.url).searchParams.get("persona") as PersonaKey | null;
  if (!key || !PERSONA_KEYS.includes(key)) return Response.json({ error: "persona required" }, { status: 400 });
  return Response.json({ runs: await listThreadRuns(id, PERSONAS[key]) });
}
