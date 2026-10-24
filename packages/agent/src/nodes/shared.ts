import { chartStepId, RUN_TIME_BUDGET_MS, type Plan, type Shape, type VizSpec } from "@ask-moov/shared";
import type { AgentDeps, Row } from "../deps";
import type { State, StepResult, Caveat } from "../state";
import { AgentError } from "../errors";
import type { ChatMessage } from "../state";

export const CAVEAT_TEXT: Record<string, string> = {
  inferred_from_next_tap: "Time at a location is inferred from the next tap somewhere else. It is an upper bound, not a measurement.",
  scope_limited: "Results cover only the sections and students in your scope.",
  reader_offline_in_window: "A reader was offline during part of this window, so some taps are missing rather than absent.",
  no_exit_kiosk: "This school has no exit kiosk. Leaving the building is inferred from the absence of later taps.",
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

/** What the critic and presenter see per step: counts, columns, a few rows, the scalar. Never the full result. */
export async function summarizeSteps(state: State, deps: AgentDeps): Promise<string> {
  const plan = state.plan_output;
  if (!plan || plan.kind !== "plan") return "";
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
      if ((r.row_count ?? 0) > 0) {
        const { rows } = await deps.results.get(state.run_id, step.id);
        sample = rows.slice(0, SAMPLE_ROWS);
      }
      body = `row_count: ${r.row_count ?? 0}\ncolumns: ${(r.columns ?? []).join(", ")}\n${r.value !== undefined ? `value: ${JSON.stringify(r.value)}\n` : ""}sample_rows: ${JSON.stringify(sample)}`;
    }
    parts.push([head, def, sql, body, "</step>"].filter(Boolean).join("\n"));
  }
  return parts.join("\n");
}
