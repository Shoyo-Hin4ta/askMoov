/**
 * Golden evals (design doc 12). Invokes the shared runtime directly, no HTTP, two passes: episodes off, then on.
 *   npm run evals                      both passes, writes packages/evals/report.md (the full-suite artifact; only a full run writes it)
 *   npm run evals -- --only teacher-   run cases whose id starts with the prefix (single pass, episodes off); writes report-only.md
 *   npm run evals -- --label no-stories  label the report section (for the null-data baseline)
 * Every case leaves a normal trace in ops.*, so /ops shows eval runs too.
 */
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimRun, closePools, enqueueRun, envInt, getAdminPool } from "@ask-moov/db";
import { executeRun, type State } from "@ask-moov/agent";
import { personaFor, type PersonaKey } from "@ask-moov/shared";

type Expect = {
  kind?: "plan" | "out_of_scope"; reason?: string; metrics?: string[]; steps_min?: number; viz_type?: string; viz_metric?: string; path?: string; options_min?: number;
  result?: { formula?: string; value_is?: number | null; value_min?: number; value_between?: [number, number]; row_count_min?: number; row_count_between?: [number, number] };
  /** Caveat kinds the run must carry (design 12 `caveats_include`), e.g. inferred_from_next_tap on a dwell question. */
  caveats_include?: string[];
  no_out_of_scope_rows?: boolean; no_public_sql?: boolean;
};
type Case = { id: string; persona: PersonaKey; question: string; expect: Expect };
/** run_id is the ops.runs key: rows are matched by it (or by thread_id like 'eval-%'), never by a clock. */
type Outcome = { id: string; run_id: string | null; pass: boolean; reasons: string[]; latency_ms: number; tokens: number; path: string | null; replans: number; uncertain: boolean };

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "seeded";
const dir = new URL("../golden/", import.meta.url).pathname;
const cases: Case[] = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Case[])
  .filter((c) => !only || c.id.startsWith(only));
const gitSha = (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "unknown"; } })();

async function runCase(c: Case, episodesEnabled: boolean): Promise<Outcome> {
  const id = randomUUID();
  const persona = personaFor(c.persona);
  await enqueueRun({ id, thread_id: `eval-${c.id}-${episodesEnabled ? "on" : "off"}-${Date.now().toString(36)}`, persona, question: c.question, git_sha: gitSha });
  const run = await claimRun(id);
  if (!run) throw new Error("could not claim eval run");
  const final = await executeRun(run, { runTokenCap: envInt("RUN_TOKEN_CAP", 150_000), episodesEnabled, chaosEnabled: false, gitSha });
  const admin = getAdminPool();
  const meta = (await admin.query("SELECT latency_ms, total_tokens, path, uncertain, error FROM ops.runs WHERE id = $1", [id])).rows[0]!;
  const replans = Number((await admin.query("SELECT count(*) AS n FROM ops.run_steps WHERE run_id = $1 AND node = 'plan' AND error IS NULL", [id])).rows[0]!["n"]) - 1;
  await admin.end();
  const reasons = final ? await check(c, final, persona.user_id, persona.role) : [`run failed: ${meta["error"]}`];
  return { id: c.id, run_id: id, pass: reasons.length === 0, reasons, latency_ms: Number(meta["latency_ms"] ?? 0), tokens: Number(meta["total_tokens"] ?? 0), path: meta["path"] as string | null, replans: Math.max(0, replans), uncertain: Boolean(meta["uncertain"]) };
}

async function check(c: Case, s: State, userId: number, role: string): Promise<string[]> {
  const e = c.expect, out: string[] = [];
  const plan = s.plan_output;
  if (e.kind && plan?.kind !== e.kind) out.push(`kind: expected ${e.kind}, got ${plan?.kind ?? "none"}${s.error ? ` (error: ${s.error})` : ""}`);
  if (e.reason && plan?.kind === "out_of_scope" && plan.reason !== e.reason) out.push(`reason: expected ${e.reason}, got ${plan.reason}`);
  if (e.options_min && plan?.kind === "out_of_scope" && (plan.options?.length ?? 0) < e.options_min) out.push(`options: expected >= ${e.options_min}`);
  const metrics = plan?.kind === "plan" ? plan.steps.flatMap((st) => (st.kind === "spec" ? [st.spec.metric] : [])) : [];
  for (const m of e.metrics ?? []) if (!metrics.includes(m as never)) out.push(`metric ${m} not in plan (${metrics.join(",") || "none"})`);
  if (e.steps_min && plan?.kind === "plan" && plan.steps.length < e.steps_min) out.push(`steps: expected >= ${e.steps_min}, got ${plan.steps.length}`);
  if (e.viz_type && s.viz?.type !== e.viz_type) out.push(`viz: expected ${e.viz_type}, got ${s.viz?.type ?? "none"}`);
  for (const k of e.caveats_include ?? []) if (!s.caveats.some((c) => c.kind === k)) out.push(`caveat ${k} missing (${s.caveats.map((c) => c.kind).join(",") || "none"})`);
  if (e.viz_metric && plan?.kind === "plan") {
    // the chart must be drawn from the expected metric's step, whatever else the planner listed in answer_from
    const want = plan.steps.find((st) => st.kind === "spec" && st.spec.metric === e.viz_metric)?.id;
    if (!want) out.push(`viz_metric: no spec step uses ${e.viz_metric}`);
    else if (s.viz?.step !== want) out.push(`viz step: expected ${want} (${e.viz_metric}), got ${s.viz?.step ?? "none"}`);
  }
  if (e.path && s.path !== e.path) out.push(`path: expected ${e.path}, got ${s.path}`);
  if (e.result && plan?.kind === "plan") {
    // the value under test: the named calc formula's step, else the expected metric's step, else the last answer_from step; a sanity step the planner appends must not shadow it
    const calcStep = e.result.formula ? plan.steps.find((st) => st.kind === "calc" && st.formula === e.result!.formula)?.id : undefined;
    if (e.result.formula && !calcStep) out.push(`no calc step with formula ${e.result.formula} (steps: ${plan.steps.map((st) => (st.kind === "calc" ? `calc ${st.formula}` : st.kind)).join(", ")})`);
    const expectedStep = calcStep ?? plan.steps.find((st) => st.kind === "spec" && (e.metrics ?? []).includes(st.spec.metric))?.id;
    const stepId = expectedStep ?? plan.answer_from[plan.answer_from.length - 1]!;
    const r = s.steps[stepId];
    const v = typeof r?.value === "string" ? Number(r.value) : (r?.value as number | undefined);
    if (e.result.value_is !== undefined && !(e.result.value_is === null ? r?.value === null : v === e.result.value_is)) out.push(`value: expected ${JSON.stringify(e.result.value_is)}, got ${JSON.stringify(r?.value)}`);
    if (e.result.value_min !== undefined && !(typeof v === "number" && v >= e.result.value_min)) out.push(`value: expected >= ${e.result.value_min}, got ${JSON.stringify(r?.value)}`);
    if (e.result.value_between && !(typeof v === "number" && v >= e.result.value_between[0] && v <= e.result.value_between[1])) out.push(`value: expected in [${e.result.value_between}], got ${JSON.stringify(r?.value)}`);
    if (e.result.row_count_min !== undefined && !((r?.row_count ?? 0) >= e.result.row_count_min)) out.push(`rows: expected >= ${e.result.row_count_min}, got ${r?.row_count}`);
    if (e.result.row_count_between && !((r?.row_count ?? 0) >= e.result.row_count_between[0] && (r?.row_count ?? 0) <= e.result.row_count_between[1])) out.push(`rows: expected in [${e.result.row_count_between}], got ${r?.row_count}`);
  }
  if (e.no_public_sql && plan?.kind === "plan") for (const st of plan.steps) if (st.kind === "sql" && /\bpublic\./i.test(st.sql)) out.push(`sql step ${st.id} names public.*`);
  if (e.no_out_of_scope_rows && role === "teacher" && plan?.kind === "plan") {
    const admin = getAdminPool();
    const mine = new Set((await admin.query("SELECT r.student_id FROM public.rosters r JOIN public.sections sec ON sec.id = r.section_id WHERE sec.teacher_id = $1", [userId])).rows.map((x) => String(x["student_id"])));
    for (const st of plan.steps) {
      const rows = (await admin.query("SELECT rows FROM ops.run_results WHERE run_id = $1 AND step_id = $2", [s.run_id, st.id])).rows[0]?.["rows"] as Record<string, unknown>[] | undefined;
      for (const row of rows ?? []) if (row["student_id"] !== undefined && !mine.has(String(row["student_id"]))) { out.push(`step ${st.id} returned student ${row["student_id"]} outside the teacher's scope`); break; }
    }
    await admin.end();
  }
  return out;
}

function table(title: string, outcomes: Outcome[]): string {
  const passed = outcomes.filter((o) => o.pass).length;
  const p50 = [...outcomes].sort((a, b) => a.latency_ms - b.latency_ms)[Math.floor(outcomes.length / 2)]?.latency_ms ?? 0;
  const lines = [
    `### ${title}`, "",
    `pass ${passed}/${outcomes.length} · replan rate ${pct(outcomes.filter((o) => o.replans > 0).length, outcomes.length)} · tier 3 rate ${pct(outcomes.filter((o) => o.path === "generated").length, outcomes.length)} · uncertain ${outcomes.filter((o) => o.uncertain).length} · tokens/question ${Math.round(outcomes.reduce((a, o) => a + o.tokens, 0) / Math.max(1, outcomes.length))} · p50 latency ${p50} ms`, "",
    "| case | run | pass | path | replans | tokens | ms | notes |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...outcomes.map((o) => `| ${o.id} | ${o.run_id ?? ""} | ${o.pass ? "✓" : "✗"} | ${o.path ?? ""} | ${o.replans} | ${o.tokens} | ${o.latency_ms} | ${o.reasons.join("; ").replace(/\|/g, "/")} |`),
  ];
  return lines.join("\n");
}
const pct = (n: number, d: number) => `${d ? Math.round((100 * n) / d) : 0}%`;

async function pass(episodesEnabled: boolean): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const c of cases) {
    // a case whose runtime throws (e.g. the trace store refused a write) is one failed row, not the end of the suite
    const o = await runCase(c, episodesEnabled).catch((e: unknown): Outcome => ({
      id: c.id, run_id: null, pass: false, reasons: [`runner error: ${e instanceof Error ? e.message : String(e)}`], latency_ms: 0, tokens: 0, path: null, replans: 0, uncertain: false,
    }));
    out.push(o);
    console.log(`${o.pass ? "✓" : "✗"} ${c.id} run ${o.run_id ?? "none"} (${o.latency_ms} ms, ${o.tokens} tok${o.path ? `, ${o.path}` : ""})${o.reasons.length ? `\n    ${o.reasons.join("\n    ")}` : ""}`);
  }
  return out;
}

const started = new Date();
console.log(`evals: ${cases.length} cases, label ${label}, git ${gitSha.slice(0, 8)}, started ${started.toISOString()} (UTC, same clock as ops.runs)`);
const sections: string[] = [`# Ask MOOV evals (${label})`, "", `${started.toISOString()} · git ${gitSha.slice(0, 8)} · ${cases.length} cases`, ""];
console.log("\n== pass 1: episodes off ==");
const off = await pass(false);
sections.push(table("Episodes off", off));
if (!only) {
  console.log("\n== pass 2: episodes on ==");
  const on = await pass(true);
  sections.push("", table("Episodes on", on));
  const d = (f: (o: Outcome[]) => number) => f(on) - f(off);
  sections.push("", "### Delta (on minus off, as measured)", "",
    `passes ${d((o) => o.filter((x) => x.pass).length) >= 0 ? "+" : ""}${d((o) => o.filter((x) => x.pass).length)} · replans ${d((o) => o.filter((x) => x.replans > 0).length)} · tokens/question ${Math.round(d((o) => o.reduce((a, x) => a + x.tokens, 0) / Math.max(1, o.length)))}`);
}
// A partial run must never replace the full-suite artifact: it gets its own file.
const reportPath = new URL(only ? "../report-only.md" : "../report.md", import.meta.url).pathname;
writeFileSync(reportPath, sections.join("\n") + "\n");
console.log(`\nreport: ${reportPath}`);
await closePools();
