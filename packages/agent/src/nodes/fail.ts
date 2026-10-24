import type { State, StateUpdate } from "../state";

/** Terminal. The worker writes state.error to runs.error. */
export async function failNode(state: State): Promise<StateUpdate> {
  return { error: state.error ?? "unknown failure", last_node: "fail" };
}
