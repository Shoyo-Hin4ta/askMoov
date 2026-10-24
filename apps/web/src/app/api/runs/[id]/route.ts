import { getRunView } from "@ask-moov/db";
import { isRunId } from "@/lib/run-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the UI polls once a second (design doc 9.3). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isRunId(id)) return Response.json({ error: "bad run id" }, { status: 400 });
  const view = await getRunView(id);
  return view ? Response.json(view) : Response.json({ error: "not found" }, { status: 404 });
}
