import { Sketch } from "@ask-moov/shared";
import type { AgentDeps } from "../deps";
import { BudgetExceededError, RunBudgetError } from "../errors";
import { MODELS } from "../llm";
import { sketchSystem } from "../prompts";
import type { State, StateUpdate } from "../state";
import { runBudget } from "./shared";

/** Small, fast, fails open. Its output is only the episode retrieval key. */
export async function sketchNode(state: State, deps: AgentDeps): Promise<StateUpdate> {
  try {
    const { output } = await deps.llm.callStructured({
      node: "sketch",
      model: MODELS.sketch,
      schema: Sketch,
      system: sketchSystem(),
      messages: [{ role: "user", content: `<question>${state.question}</question>` }],
      max_tokens: 2_000,
      effort: "low",
      budget: runBudget(state),
    });
    return { sketch_key: output, last_node: "sketch" };
  } catch (e) {
    if (e instanceof BudgetExceededError || e instanceof RunBudgetError) throw e;
    return { sketch_key: null, last_node: "sketch" };
  }
}
