import { chartStepId, metricDef, RUN_TIME_BUDGET_MS, type Plan, type Shape, type Step, type VizSpec } from "@ask-moov/shared";
import type { AgentDeps, Row } from "../deps";
import type { State, StepResult, Caveat } from "../state";
import { AgentError } from "../errors";
import { isSummable, stepFacts, type Facts } from "../facts";
import { entityLabels, withLabels } from "../labels";
import type { ChatMessage } from "../state";

export const CAVEAT_TEXT: Record<string, string> = {
  inferred_from_next_tap: "Time at a location is inferred from the next tap somewhere else. It is an upper bound, not a measurement.",
  scope_limited: "Results cover only the sections and students in your scope.",
  reader_offline_in_window: "A reader was offline during part of this window, so some taps are missing rather than absent.",
  no_exit_kiosk: "This school has no exit kiosk. Leaving the building is inferred from the absence of later taps.",
  no_wing_group: "Rooms outside the wings (the gym, cafeteria, library, offices and entrances) have no wing; their rows appear under an empty wing, shown as \"No wing\".",
};

export function caveat(kind: string, stepId?: string): Caveat {
  return { kind, text: CAVEAT_TEXT[kind] ?? kind, ...(stepId ? { step_id: stepId } : {}) };
}

/** Compiled shape of the step the chart is drawn from (the presenter's recorded choice, viz.step), for the episode store. */
export function answerShape(plan: Plan, steps: Record<string, StepResult>, viz: VizSpec | null): Shape {
  const id = chartStepId(viz, plan.answer_from, (i) => steps[i]?.shape);
  return id ? (steps[id]?.shape ?? "rows") : "rows";
}

/** The run's time budget as the LLM wrapper checks it before every model call (execute checks the same clock between steps). */
export function runBudget(state: State): { started_at: number; total_ms: number } {
  return { started_at: state.started_at, total_ms: RUN_TIME_BUDGET_MS };
}

export function pathOf(plan: Plan): "compiled" | "composed" | "generated" {
  if (plan.steps.some((s) => s.kind === "sql")) return "generated";
  if (plan.steps.length > 1 || plan.steps.some((s) => s.kind === "calc")) return "composed";
  return "compiled";
}

/** Non-retryable agent errors become run failures; everything else propagates to the worker. */
export function isFatal(e: unknown): e is AgentError {
  return e instanceof AgentError && !e.retryable;
}

export function errorText(e: unknown): string {
  if (e instanceof AgentError) return `${e.name}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** Thread turns for the model: last N, consecutive same-role turns merged, always ending in the user question. */
export function threadMessages(state: State, limit = 10): { role: "user" | "assistant"; content: string }[] {
  const recent = state.messages.slice(-limit);
  const out: ChatMessage[] = [];
  for (const m of recent) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${m.content}`;
    else out.push({ ...m });
  }
  if (out.length === 0 || out[out.length - 1]!.role !== "user") out.push({ role: "user", content: state.question });
  if (out[0]!.role === "assistant") out.shift();
  return out;
}

export const SAMPLE_ROWS = 5;

/** The ids the plan used, with their names, for the critic and the presenter: "school 1: Springfield High". */
export function entitiesText(state: State): string {
  return state.resolved.entities.map((e) => `- ${e.type} ${e.id}: ${e.label}${e.detail ? ` (${e.detail})` : ""}`).join("\n") || "(none)";
}

/** Whether a step's value sums across rows: a registry count or sum does; averages, rates, distinct counts and model SQL do not. */
function summable(step: Step): boolean {
  return step.kind === "spec" && isSummable(metricDef(step.spec.metric).expression);
}

/**
 * What the critic and presenter see per step: counts, columns, a few rows with ids written as "Name (id)", the scalar, and
 * a facts block code computed over the full result (peak, low, total, first and last, top per series, empty dimensions).
 * Never the full result: the model reads the shape of the data, it does not scan it.
 */
export async function summarizeSteps(state: State, deps: AgentDeps): Promise<string> {
  const plan = state.plan_output;
  if (!plan || plan.kind !== "plan") return "";
  const scoped = (sql: string, params: unknown[]) => deps.scopedQuery(state.persona, sql, params).then((x) => x.rows);
  const parts: string[] = [];
  for (const step of plan.steps) {
    const r: StepResult | undefined = state.steps[step.id];
    if (!r) continue;
    const head = `<step id="${step.id}" kind="${step.kind}" status="${r.status}">`;
    const def = step.kind === "spec" ? `spec: ${JSON.stringify(step.spec)}` : step.kind === "calc" ? `formula: ${step.formula} args: ${JSON.stringify(step.args)}` : `reason: ${step.reason}`;
    const sql = r.sql ? `sql: ${r.sql}` : "";
    let body: string;
    if (r.status !== "ok") body = `error: ${r.error}`;
    else if (step.kind === "calc") body = `value: ${JSON.stringify(r.value)} (${r.explanation ?? ""})`;
    else {
      let sample: Row[] = [];
      let facts: Facts | null = null;
      if ((r.row_count ?? 0) > 0) {
        const { rows } = await deps.results.get(state.run_id, step.id);
        const columns = r.columns ?? [];
        const labelled = withLabels(rows, await entityLabels(scoped, columns, rows));
        sample = labelled.slice(0, SAMPLE_ROWS);
        facts = stepFacts(columns, labelled, r.shape, summable(step));
      }
      body = `row_count: ${r.row_count ?? 0}\ncolumns: ${(r.columns ?? []).join(", ")}\n${r.value !== undefined ? `value: ${JSON.stringify(r.value)}\n` : ""}sample_rows: ${JSON.stringify(sample)}\nfacts: ${facts ? JSON.stringify(facts) : "(no rows)"}`;
    }
    parts.push([head, def, sql, body, "</step>"].filter(Boolean).join("\n"));
  }
  return parts.join("\n");
}
