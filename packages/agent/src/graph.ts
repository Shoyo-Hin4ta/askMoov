import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { MAX_REPLANS } from "@ask-moov/shared";
import type { AgentDeps } from "./deps";
import { RetryableError } from "./errors";
import { critiqueNode } from "./nodes/critique";
import { executeNode } from "./nodes/execute";
import { failNode } from "./nodes/fail";
import { planNode } from "./nodes/plan";
import { presentNode } from "./nodes/present";
import { sketchNode } from "./nodes/sketch";
import { State, type StateUpdate } from "./state";

/**
 * sketch -> plan -> execute (one step per visit) -> critique -> present
 *                     ^          |                     |
 *                     +----------+---------------------+   replan, max 2
 * The graph is fixed. The model never picks the next node (principle 1).
 */
export type NodeName = "sketch" | "plan" | "execute" | "critique" | "present" | "fail";
type NodeFn = (state: State, deps: AgentDeps) => Promise<StateUpdate>;

export function buildGraph(deps: AgentDeps, checkpointer?: BaseCheckpointSaver) {
  const wrap = (name: NodeName, fn: NodeFn) => async (state: State): Promise<StateUpdate> => {
    // A chaos crash stands in for a worker that died: retryable, so the run goes back to the queue and the next attempt
    // resumes from the checkpoint written after `crash_after`. It leaves no run_steps row, like a real dead process.
    if (deps.chaos && deps.attempt === 1 && state.last_node === deps.chaos.crash_after) {
      throw new RetryableError(`chaos: crashed before ${name} (after ${deps.chaos.crash_after}) on attempt 1`);
    }
    const started = new Date();
    try {
      const update = await fn(state, deps);
      await deps.trace.step({ run_id: state.run_id, node: name, attempt: deps.attempt, started_at: started, duration_ms: Date.now() - started.getTime(), input_summary: inputSummary(state), output_summary: outputSummary(update), error: update.error ?? null });
      return update;
    } catch (e) {
      await deps.trace.step({ run_id: state.run_id, node: name, attempt: deps.attempt, started_at: started, duration_ms: Date.now() - started.getTime(), input_summary: inputSummary(state), output_summary: null, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      throw e;
    }
  };

  const graph = new StateGraph(State)
    .addNode("sketch", wrap("sketch", sketchNode))
    .addNode("plan", wrap("plan", planNode))
    .addNode("execute", wrap("execute", executeNode))
    .addNode("critique", wrap("critique", critiqueNode))
    .addNode("present", wrap("present", presentNode))
    .addNode("fail", wrap("fail", failNode))
    .addEdge(START, "sketch")
    .addEdge("sketch", "plan")
    .addConditionalEdges("plan", routeAfterPlan, ["execute", "present", "fail"])
    .addConditionalEdges("execute", routeAfterExecute, ["execute", "plan", "critique", "fail"])
    .addConditionalEdges("critique", routeAfterCritique, ["present", "plan"])
    .addEdge("present", END)
    .addEdge("fail", END);

  return graph.compile({ checkpointer });
}

export function routeAfterPlan(state: State): "execute" | "present" | "fail" {
  if (state.error) return "fail";
  if (!state.plan_output) return "fail";
  return state.plan_output.kind === "out_of_scope" ? "present" : "execute";
}

export function routeAfterExecute(state: State): "execute" | "plan" | "critique" | "fail" {
  if (state.error) return "fail";
  if (state.replan_context) return "plan";
  const total = state.plan_output?.kind === "plan" ? state.plan_output.steps.length : 0;
  return state.step_index < total ? "execute" : "critique";
}

export function routeAfterCritique(state: State): "present" | "plan" {
  if (state.error) return "present";
  if (state.critic_verdict?.pass) return "present";
  if (state.uncertain) return "present";
  return state.retries.plan <= MAX_REPLANS ? "plan" : "present";
}

function inputSummary(state: State): unknown {
  return { question_chars: state.question.length, step_index: state.step_index, retries: state.retries, has_plan: Boolean(state.plan_output) };
}

function outputSummary(update: StateUpdate): unknown {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(update)) {
    if (k === "plan" && v && typeof v === "object" && "kind" in v) out["plan"] = (v as { kind: string }).kind;
    else if (Array.isArray(v)) out[k] = v.length;
    else if (v && typeof v === "object") out[k] = Object.keys(v).length;
    else if (typeof v === "string") out[k] = v.slice(0, 120);
    else out[k] = v;
  }
  return out;
}
