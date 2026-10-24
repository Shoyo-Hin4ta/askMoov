import { PERSONA_KEYS, PERSONAS, type PersonaKey } from "@ask-moov/shared";
import { listThreads } from "@ask-moov/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Thread list for the sidebar: the persona's past conversations, newest first. */
export async function GET(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get("persona") as PersonaKey | null;
  if (!key || !PERSONA_KEYS.includes(key)) return Response.json({ error: "persona required" }, { status: 400 });
  return Response.json({ threads: await listThreads(PERSONAS[key]) });
}
