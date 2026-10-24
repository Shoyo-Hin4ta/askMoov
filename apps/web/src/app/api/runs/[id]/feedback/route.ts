import { voteEpisode } from "@ask-moov/agent";
import { getAppPool, getRun } from "@ask-moov/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thumbs up (+1) or down (-2 on the episode score), one feedback row, one transaction (design doc 11.2). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { vote?: unknown } | null;
  const vote = body?.vote === 1 || body?.vote === -1 ? body.vote : null;
  if (vote === null) return Response.json({ error: "vote must be 1 or -1" }, { status: 400 });
  const run = await getRun(id);
  if (!run) return Response.json({ error: "not found" }, { status: 404 });
  if (!run.episode_id) return Response.json({ error: "this run has no episode to score" }, { status: 409 });
  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    await voteEpisode(async (sql, params) => (await client.query(sql, params)).rows, { episodeId: run.episode_id, runId: run.id, userId: run.persona.user_id, vote });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return new Response(null, { status: 204 });
}
