import { z } from "zod";
import { withLangGraph } from "@langchain/langgraph/zod";
import { Critique, EntityType, Persona, Plan, PlannerOutput, Shape, Sketch, VizSpec } from "@ask-moov/shared";

/** Graph state (design doc 4.2). No rows, no schema doc, no raw episode text. */
export const ChatMessage = z.object({ role: z.enum(["user", "assistant"]), content: z.string() });
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ResolvedEntitySchema = z.object({ type: EntityType, id: z.union([z.number(), z.string()]), label: z.string(), detail: z.string(), text: z.string() });
export const ResolvedDatesSchema = z.object({ text: z.string(), start: z.string(), end: z.string(), label: z.string(), day_of_week: z.array(z.number()).optional() });
export const CandidateSchema = z.object({ type: EntityType, id: z.union([z.number(), z.string()]), label: z.string(), detail: z.string(), confidence: z.number() });
export const LookupRecord = z.object({ type: EntityType, text: z.string(), status: z.enum(["resolved", "ambiguous", "none"]), candidates: z.array(CandidateSchema) });
export type LookupRecord = z.infer<typeof LookupRecord>;

export const StepResult = z.object({
  status: z.enum(["ok", "error"]),
  kind: z.enum(["spec", "calc", "sql"]),
  sql: z.string().optional(),
  params: z.array(z.unknown()).optional(),
  shape: Shape.optional(),
  value: z.unknown().optional(),
  row_count: z.number().optional(),
  columns: z.array(z.string()).optional(),
  explanation: z.string().optional(),
  error: z.string().optional(),
});
export type StepResult = z.infer<typeof StepResult>;

export const Caveat = z.object({ kind: z.string(), text: z.string(), step_id: z.string().optional() });
export type Caveat = z.infer<typeof Caveat>;

export const EpisodeRefSchema = z.object({ id: z.number(), question_templated: z.string(), plan: Plan });

export const Path = z.enum(["compiled", "composed", "generated"]);

const Resolved = z.object({ entities: z.array(ResolvedEntitySchema), dates: z.array(ResolvedDatesSchema) });
type Resolved = z.infer<typeof Resolved>;

/**
 * Channel names must not collide with node names (LangGraph rule), hence sketch_key / plan_output / critic_verdict.
 * Every per-run field is set by newRunInput on each run, so plain last-value channels suffice.
 * `messages` appends; `resolved` (pins) has a default and is never reset by a new run.
 */
export const State = z.object({
  run_id: z.string(),
  thread_id: z.string(),
  persona: Persona,
  question: z.string(),
  messages: withLangGraph(z.array(ChatMessage), {
    reducer: { schema: z.array(ChatMessage), fn: (a: ChatMessage[], b: ChatMessage[]): ChatMessage[] => a.concat(b) },
    default: (): ChatMessage[] => [],
  }),
  resolved: withLangGraph(Resolved, {
    reducer: { schema: Resolved, fn: (_a: Resolved, b: Resolved): Resolved => b },
    default: (): Resolved => ({ entities: [], dates: [] }),
  }),
  lookups: z.array(LookupRecord),
  sketch_key: Sketch.nullable(),
  episodes: z.array(EpisodeRefSchema),
  plan_output: PlannerOutput.nullable(),
  step_index: z.number(),
  steps: z.record(z.string(), StepResult),
  caveats: z.array(Caveat),
  critic_verdict: Critique.nullable(),
  viz: VizSpec.nullable(),
  answer: z.string().nullable(),
  uncertain: z.boolean(),
  retries: z.object({ plan: z.number(), sql: z.number(), corrective: z.number() }),
  /** Set only on a fatal error; the router sends the run to `fail`. */
  error: z.string().nullable(),
  /** Feedback for the next planner attempt (critic verdict or rejected SQL). */
  replan_context: z.string().nullable(),
  path: Path.nullable(),
  last_node: z.string().nullable(),
  schema_version: z.string(),
  git_sha: z.string(),
  started_at: z.number(),
});
export type State = z.infer<typeof State>;
export type StateUpdate = Partial<State>;

/** Input for a new run on a thread. Resets every per-run field; leaves `resolved` (pins) and prior `messages` alone. */
export function newRunInput(args: { run_id: string; thread_id: string; persona: Persona; question: string; schema_version: string; git_sha: string; now?: number }): StateUpdate {
  return {
    run_id: args.run_id,
    thread_id: args.thread_id,
    persona: args.persona,
    question: args.question,
    messages: [{ role: "user", content: args.question }],
    lookups: [],
    sketch_key: null,
    episodes: [],
    plan_output: null,
    step_index: 0,
    steps: {},
    caveats: [],
    critic_verdict: null,
    viz: null,
    answer: null,
    uncertain: false,
    retries: { plan: 0, sql: 0, corrective: 0 },
    error: null,
    replan_context: null,
    path: null,
    last_node: null,
    schema_version: args.schema_version,
    git_sha: args.git_sha,
    started_at: args.now ?? Date.now(),
  };
}
