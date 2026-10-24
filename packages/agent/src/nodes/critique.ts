import { Critique, MAX_REPLANS } from "@ask-moov/shared";
import type { AgentDeps } from "../deps";
import { MODELS } from "../llm";
import { criticSystem } from "../prompts";
import type { State, StateUpdate } from "../state";
import { errorText, isFatal, runBudget, summarizeSteps } from "./shared";

/** Sees artifacts only: question, plan, SQL, result summaries, caveats. Never planner reasoning, never prior critiques. */
export async function critiqueNode(state: State, deps: AgentDeps): Promise<StateUpdate> {
  try {
    const summary = await summarizeSteps(state, deps);
    const caveats = state.caveats.map((c) => `- ${c.text}`).join("\n") || "(none)";
    const { output } = await deps.llm.callStructured({
      node: "critique", model: MODELS.main, schema: Critique, system: criticSystem(), effort: "medium", max_tokens: 6_000, budget: runBudget(state),
      messages: [{ role: "user", content: `<question>${state.question}</question>\n<steps>\n${summary}\n</steps>\n<caveats>\n${caveats}\n</caveats>` }],
    });
    if (output.pass) return { critic_verdict: output, last_node: "critique" };
    if (state.retries.plan >= MAX_REPLANS) return { critic_verdict: output, uncertain: true, last_node: "critique" };
    return {
      critic_verdict: output,
      retries: { ...state.retries, plan: state.retries.plan + 1 },
      replan_context: `The critic rejected the previous plan.\nReason: ${output.reason}\n${output.fixes ? `Fix: ${output.fixes}` : ""}`,
      step_index: 0,
      steps: {},
      caveats: [],
      last_node: "critique",
    };
  } catch (e) {
    if (isFatal(e)) return { error: errorText(e), last_node: "critique" };
    throw e;
  }
}
