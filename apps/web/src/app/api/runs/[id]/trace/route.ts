import { getRunTrace } from "@ask-moov/db";
import { isRunId } from "@/lib/run-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One run top to bottom for the run-detail page: the run row, the node trail, every model round with its full request and
 * response, the tool calls, the rows per step and the output. Open like /ops (one user by decision); transcripts carry names.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isRunId(id)) return Response.json({ error: "bad run id" }, { status: 400 });
  const trace = await getRunTrace(id);
  return trace ? Response.json(trace) : Response.json({ error: "not found" }, { status: 404 });
}
