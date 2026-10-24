import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/** Thread memory lives in schema langgraph (migration 20261022023007). setup() is a no-op there because every version is pre-recorded. */
export function createCheckpointer(connectionString: string): PostgresSaver {
  return PostgresSaver.fromConnString(connectionString, { schema: "langgraph" });
}
