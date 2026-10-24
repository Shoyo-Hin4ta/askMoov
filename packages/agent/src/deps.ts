import type { Persona, Plan, Critique, Role, Shape, Sketch } from "@ask-moov/shared";
import type { Llm } from "./llm";
import type { SchemaDoc } from "./schema-doc";
import type { EpisodeRef } from "./episodes";
import type { ResolvedEntity } from "./tools/lookup-entity";

/** Everything the graph needs from the outside world. The worker builds the real one; tests build fakes. */
export type Row = Record<string, unknown>;

export type AgentDeps = {
  llm: Llm;
  schemaDoc: SchemaDoc;
  /** ISO timestamp. "Now" for every date and live question. */
  frozenNow: string;
  /** Runs one statement on the query pool inside a scoped transaction (set_config for the persona). */
  scopedQuery(persona: Persona, sql: string, params: unknown[]): Promise<{ rows: Row[]; columns: string[] }>;
  /** ops.run_results. Rows never enter graph state. */
  results: {
    put(runId: string, stepId: string, columns: string[], rows: Row[]): Promise<void>;
    get(runId: string, stepId: string): Promise<{ columns: string[]; rows: Row[] }>;
  };
  /** null when EPISODES_ENABLED=false. Writing happens in the worker after present. */
  episodes: {
    retrieve(args: { sketch: Sketch; role: Role; questionTemplated: string; schemaVersion: string }): Promise<EpisodeRef[]>;
    write(e: { role: Role; questionTemplated: string; plan: Plan; shape: Shape; critique: Critique | null; score: number; schemaVersion: string; gitSha: string }): Promise<number>;
  } | null;
  trace: {
    toolCall(r: { run_id: string; node: string; tool: string; args: unknown; result: unknown; duration_ms: number }): Promise<void>;
    step(r: { run_id: string; node: string; attempt: number; started_at: Date; duration_ms: number; input_summary: unknown; output_summary: unknown; error: string | null }): Promise<void>;
  };
  attempt: number;
  chaos: { crash_after: string } | null;
  /** Entities the user chose by clicking a clarification chip for this run (ops.runs.pins). Seeded into the thread's pins by the plan node. */
  pins: ResolvedEntity[];
  /** Unit tests only: skip EXPLAIN. */
  skipExplain?: boolean;
};
