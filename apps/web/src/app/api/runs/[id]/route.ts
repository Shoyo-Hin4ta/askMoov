import { getRunView } from "@ask-moov/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the UI polls once a second (design doc 9.3). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "bad run id" }, { status: 400 });
  const view = await getRunView(id);
  return view ? Response.json(view) : Response.json({ error: "not found" }, { status: 404 });
}
