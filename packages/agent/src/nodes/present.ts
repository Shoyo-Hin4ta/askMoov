import { MAX_CORRECTIVE_CALLS, MAX_PROSE_CORRECTIONS, presentationFor, vizTypeForShape, type Presentation, type VizSpec } from "@ask-moov/shared";
import type { AgentDeps } from "../deps";
import { LlmParseError, ProseValidationError, VizValidationError } from "../errors";
import { MODELS, type MessageParam } from "../llm";
import { presenterSystem } from "../prompts";
import { allowedFrom, proseMismatch } from "../prose";
import type { State, StateUpdate, StepResult } from "../state";
import { composeSummary, entitiesText, errorText, isFatal, numberSources, runBudget, stepSummaries } from "./shared";

/**
 * The presenter names the step the chart is drawn from (viz.step) out of the plan's answer_from list; code derives the
 * chart type per candidate, checks the chosen step can supply the fields the chart names, allows one corrective call
 * (schema miss or field mismatch), then fails loudly. One decision, recorded in viz, read by the UI and the episode store.
 *
 * Code also checks every number the presenter wrote against the numbers it was shown (prose.ts): a miss gets a corrective
 * call naming the numbers, twice, then ProseValidationError. Both checks run on the same output and share one correction
 * round when both fail, so a chart fix never spends the only chance to fix a number.
 */
export async function presentNode(state: State, deps: AgentDeps): Promise<StateUpdate> {
  const plan = state.plan_output;
  if (!plan) return { error: "present called without a plan", last_node: "present" };

  if (plan.kind === "out_of_scope") {
    const answer = plan.suggestion ? `${plan.message}\n\n${plan.suggestion}` : plan.message;
    return { answer, viz: null, messages: [{ role: "assistant", content: answer }], last_node: "present" };
  }

  try {
    const parts = await stepSummaries(state, deps);
    const summary = composeSummary(parts);
    const caveats = state.caveats.map((c) => c.text);
    const candidates = plan.answer_from.map((id) => describeCandidate(id, state.steps[id])).join("\n");
    const base: MessageParam[] = [{
      role: "user",
      content: `<question>${state.question}</question>\n<entities>\n${entitiesText(state)}\n</entities>\n<steps>\n${summary}\n</steps>\n<caveats>\n${caveats.map((c) => `- ${c}`).join("\n") || "(none)"}\n</caveats>\n<answer_steps>\n${candidates}\n</answer_steps>\n<uncertain>${state.uncertain ? `yes: ${state.critic_verdict?.reason ?? ""}` : "no"}</uncertain>`,
    }];
    // what the writer may quote: the data blocks it was shown, minus the SQL text and the critic's free text (prose.ts)
    const allowed = allowedFrom([state.question, entitiesText(state), ...numberSources(parts), candidates]);
    const schema = presentationFor(plan.answer_from);
    let messages = base;
    let corrective = 0;
    let proseFixes = 0;
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
      const vizProblem = vizMismatch(output.viz, state.steps[output.viz.step]);
      const proseProblem = proseMismatch(modelStrings(output), allowed);
      if (!vizProblem && !proseProblem) {
        const viz: VizSpec = { ...output.viz, caveats: mergeCaveats(output.viz.caveats, caveats) };
        return { answer: output.answer_md, viz, messages: [{ role: "assistant", content: output.answer_md }], last_node: "present" };
      }
      if (vizProblem && corrective >= MAX_CORRECTIVE_CALLS) throw new VizValidationError(vizProblem);
      if (proseProblem && proseFixes >= MAX_PROSE_CORRECTIONS) throw new ProseValidationError(proseProblem);
      if (vizProblem) corrective += 1;
      if (proseProblem) proseFixes += 1;
      const fixes = [
        vizProblem ? `${vizProblem}. Name x.field and y.field from the columns of viz.step, or set viz.step to the step whose columns you described.` : "",
        proseProblem ? `${proseProblem}. Every number in answer_md, viz.title, the axis labels, series and caveats must appear in the steps, facts, sample rows or entities above, at most rounded for reading, or be a 0 to 1 rate written as a percentage. Do not compute new numbers: no differences, no sums, no unit conversions, no counting rows, no end times. If a comparison was not computed, put the computed numbers side by side.` : "",
      ].filter(Boolean).join("\n");
      messages = [
        ...base,
        { role: "assistant", content: JSON.stringify(output) },
        { role: "user", content: `That presentation failed validation: ${fixes}\nReturn a corrected presentation.` },
      ];
    }
  } catch (e) {
    if (isFatal(e)) return { error: errorText(e), last_node: "present" };
    throw e;
  }
}

/** Every string the model wrote and the reader will see; code's own caveat sentences are merged in afterwards and carry no digits. */
function modelStrings(output: Presentation): (string | undefined)[] {
  const v = output.viz;
  return [output.answer_md, v.title, v.x?.label, v.y?.label, ...(v.series ?? []), ...v.caveats];
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
