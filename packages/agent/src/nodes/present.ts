import { MAX_CORRECTIVE_CALLS, presentationFor, vizTypeForShape, type Presentation, type VizSpec } from "@ask-moov/shared";
import type { AgentDeps } from "../deps";
import { LlmParseError, VizValidationError } from "../errors";
import { MODELS, type MessageParam } from "../llm";
import { presenterSystem } from "../prompts";
import type { State, StateUpdate, StepResult } from "../state";
import { entitiesText, errorText, isFatal, runBudget, summarizeSteps } from "./shared";

/**
 * The presenter names the step the chart is drawn from (viz.step) out of the plan's answer_from list; code derives the
 * chart type per candidate, checks the chosen step can supply the fields the chart names, allows one corrective call
 * (schema miss or field mismatch), then fails loudly. One decision, recorded in viz, read by the UI and the episode store.
 */
export async function presentNode(state: State, deps: AgentDeps): Promise<StateUpdate> {
  const plan = state.plan_output;
  if (!plan) return { error: "present called without a plan", last_node: "present" };

  if (plan.kind === "out_of_scope") {
    const answer = plan.suggestion ? `${plan.message}\n\n${plan.suggestion}` : plan.message;
    return { answer, viz: null, messages: [{ role: "assistant", content: answer }], last_node: "present" };
  }

  try {
    const summary = await summarizeSteps(state, deps);
    const caveats = state.caveats.map((c) => c.text);
    const candidates = plan.answer_from.map((id) => describeCandidate(id, state.steps[id])).join("\n");
    const base: MessageParam[] = [{
      role: "user",
      content: `<question>${state.question}</question>\n<entities>\n${entitiesText(state)}\n</entities>\n<steps>\n${summary}\n</steps>\n<caveats>\n${caveats.map((c) => `- ${c}`).join("\n") || "(none)"}\n</caveats>\n<answer_steps>\n${candidates}\n</answer_steps>\n<uncertain>${state.uncertain ? `yes: ${state.critic_verdict?.reason ?? ""}` : "no"}</uncertain>`,
    }];
    const schema = presentationFor(plan.answer_from);
    let messages = base;
    let corrective = 0;
    for (;;) {
      let output: Presentation;
      try {
        ({ output } = await deps.llm.callStructured({ node: "present", model: MODELS.main, schema, system: presenterSystem(), effort: "medium", max_tokens: 8_000, budget: runBudget(state), messages }));
      } catch (e) {
        if (e instanceof LlmParseError && corrective < MAX_CORRECTIVE_CALLS) {
          corrective += 1;
          messages = [...base, { role: "user", content: `Your previous reply did not match the required shape: ${e.message}. Reply with the JSON object only; viz.step must be one of ${plan.answer_from.join(", ")}.` }];
          continue;
        }
        throw e;
      }
      const problem = vizMismatch(output.viz, state.steps[output.viz.step]);
      if (!problem) {
        const viz: VizSpec = { ...output.viz, caveats: mergeCaveats(output.viz.caveats, caveats) };
        return { answer: output.answer_md, viz, messages: [{ role: "assistant", content: output.answer_md }], last_node: "present" };
      }
      if (corrective >= MAX_CORRECTIVE_CALLS) throw new VizValidationError(problem);
      corrective += 1;
      messages = [
        ...base,
        { role: "assistant", content: JSON.stringify(output) },
        { role: "user", content: `That presentation failed validation: ${problem}\nReturn a corrected presentation: name x.field and y.field from the columns of viz.step, or set viz.step to the step whose columns you described.` },
      ];
    }
  } catch (e) {
    if (isFatal(e)) return { error: errorText(e), last_node: "present" };
    throw e;
  }
}

/** One line per answer_from candidate: "b: table, 24 rows, columns wing, period, value". */
function describeCandidate(id: string, r: StepResult | undefined): string {
  const parts = [`${id}: ${vizTypeForShape(r?.shape ?? "rows")}`];
  if (r?.kind === "calc") parts.push("calc value, no rows");
  if (r?.row_count !== undefined) parts.push(`${r.row_count} rows`);
  if (r?.columns?.length) parts.push(`columns ${r.columns.join(", ")}`);
  return `- ${parts.join(", ")}`;
}

/**
 * The chart must be drawable from the step the presenter chose: x.field and y.field name columns of that step.
 * A stat tile uses no fields and series holds display labels, so neither is checked. Returns the problem text, or null.
 */
export function vizMismatch(viz: { type: string; step: string; x?: { field: string }; y?: { field: string } }, step: StepResult | undefined): string | null {
  if (!step || step.status !== "ok") return `viz.step ${viz.step} has no result to draw`;
  if (viz.type === "stat") return null;
  const cols = step.columns;
  if (!cols) return `step ${viz.step} is a ${step.kind} step with no rows, so it cannot be drawn as ${viz.type}; choose a step with rows or use stat`;
  const missing = [viz.x?.field, viz.y?.field].filter((f): f is string => typeof f === "string" && f.length > 0 && !cols.includes(f));
  if (missing.length === 0) return null;
  return `${missing.join(" and ")} ${missing.length === 1 ? "is not a column" : "are not columns"} of step ${viz.step}; its columns are ${cols.join(", ")}`;
}

/** The presenter may reword caveats, never drop them: anything from state not recognizable in its list is appended. */
function mergeCaveats(fromModel: string[], required: string[]): string[] {
  const out = [...fromModel];
  for (const c of required) {
    const key = c.toLowerCase().slice(0, 25);
    if (!out.some((m) => m.toLowerCase().includes(key))) out.push(c);
  }
  return out;
}
