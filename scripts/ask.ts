/**
 * Ask one question end to end through the running app and print the trail and the answer.
 *   npx tsx --env-file=.env scripts/ask.ts teacher "How many bathroom passes did Bart take this month?" [thread_id]
 * Requires `npm run dev` on APP_URL and ANTHROPIC_API_KEY in .env.
 */
import { randomUUID } from "node:crypto";
import { requireEnv } from "@ask-moov/db";

const [persona = "teacher", question = "How many bathroom passes did Bart take this month?", threadArg] = process.argv.slice(2);
const base = requireEnv("APP_URL");
const run_id = randomUUID();
const thread_id = threadArg ?? `t-${Date.now()}`;

const ask = await fetch(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id, thread_id, persona, question }) });
console.log(`POST /api/ask -> ${ask.status}`, await ask.json());
if (ask.status !== 202) process.exit(1);

const seen = new Set<string>();
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(`${base}/api/runs/${run_id}`);
  const view = (await res.json()) as { status: string; current_node: string | null; attempt: number; error: string | null; trail: { node: string; duration_ms: number; error: string | null }[]; output?: { answer_md: string; viz: unknown; caveats: string[]; steps: { id: string; kind: string; sql?: string; row_count?: number; value?: unknown }[] } };
  for (const t of view.trail) {
    const key = `${t.node}:${t.duration_ms}`;
    if (!seen.has(key)) { seen.add(key); console.log(`  ${t.node.padEnd(9)} ${String(t.duration_ms).padStart(6)}ms${t.error ? `  ERROR ${t.error}` : ""}`); }
  }
  if (view.status === "succeeded" || view.status === "failed") {
    console.log(`\nstatus: ${view.status} (attempt ${view.attempt})${view.error ? `\nerror: ${view.error}` : ""}`);
    if (view.output) {
      console.log(`\n${view.output.answer_md}\n`);
      for (const s of view.output.steps) console.log(`[${s.id}] ${s.kind}${s.row_count !== undefined ? ` rows=${s.row_count}` : ""}${s.value !== undefined ? ` value=${JSON.stringify(s.value)}` : ""}\n${s.sql ?? ""}\n`);
      if (view.output.caveats.length) console.log("caveats:", view.output.caveats);
      console.log("viz:", JSON.stringify(view.output.viz));
    }
    console.log(`thread_id: ${thread_id}`);
    process.exit(view.status === "succeeded" ? 0 : 2);
  }
}
console.log("timed out waiting for the run");
process.exit(3);
