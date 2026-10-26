import { z } from "zod";
import { EntityType, Metric, Shape } from "./metrics";
import { entityId, Spec } from "./spec";

/**
 * Calc arguments are a list, not a record: structured outputs need closed object schemas. No .describe() anywhere in model-facing schemas: each one becomes a $ref, which the API rejects under a union root; field hints live in the prompt.
 * The planner's objects are strict (see spec.ts): an unknown key is a parse error the corrective call fixes, never a silent drop.
 */
export const CalcArg = z.strictObject({
  name: z.string(),
  /** A number, or a "$step.value" / "$step.rows[*].col" reference. */
  value: z.union([z.number(), z.string()]),
});

export const SpecStep = z.strictObject({ id: z.string(), kind: z.literal("spec"), spec: Spec });
export const CalcStep = z.strictObject({
  id: z.string(),
  kind: z.literal("calc"),
  formula: z.string(),
  args: z.array(CalcArg),
});
export const SqlStep = z.strictObject({
  id: z.string(),
  kind: z.literal("sql"),
  sql: z.string(),
  reason: z.string(),
});
export const Step = z.discriminatedUnion("kind", [SpecStep, CalcStep, SqlStep]);
export type Step = z.infer<typeof Step>;
export type SpecStep = z.infer<typeof SpecStep>;
export type CalcStep = z.infer<typeof CalcStep>;
export type SqlStep = z.infer<typeof SqlStep>;

export const Plan = z.strictObject({
  kind: z.literal("plan"),
  steps: z.array(Step),
  answer_from: z.array(z.string()),
  expected_shape: Shape,
});
export type Plan = z.infer<typeof Plan>;

export const OUT_OF_SCOPE_REASONS = ["not_in_data", "identity", "action", "permission", "advice_or_prediction", "needs_clarification"] as const;
export const OutOfScopeReason = z.enum(OUT_OF_SCOPE_REASONS);
export type OutOfScopeReason = z.infer<typeof OutOfScopeReason>;

export const ClarificationOption = z.strictObject({
  label: z.string(),
  /** The candidate itself. label is the plain name and detail what distinguishes it, so a click can pin it by id. */
  entity: z.strictObject({ type: z.string(), id: entityId(), label: z.string().optional(), detail: z.string().optional() }).optional(),
});
export type ClarificationOption = z.infer<typeof ClarificationOption>;

/** A clarification chip the user clicked: the entity they chose, carried back by id so no lookup has to re-decide it. */
export const Pin = z.object({ type: EntityType, id: entityId(), label: z.string().min(1).max(200), detail: z.string().max(200).optional() });
export type Pin = z.infer<typeof Pin>;

export const OutOfScope = z.strictObject({
  kind: z.literal("out_of_scope"),
  reason: OutOfScopeReason,
  message: z.string(),
  suggestion: z.string().optional(),
  options: z.array(ClarificationOption).optional(),
});
export type OutOfScope = z.infer<typeof OutOfScope>;

export const PlannerOutput = z.discriminatedUnion("kind", [Plan, OutOfScope]);
export type PlannerOutput = z.infer<typeof PlannerOutput>;

/** Sketch node output. Only ever used as the episode retrieval key. */
export const Sketch = z.object({
  metrics: z.array(Metric),
  entity_types: z.array(EntityType),
  shape: Shape,
});
export type Sketch = z.infer<typeof Sketch>;

export const Critique = z.object({
  pass: z.boolean(),
  reason: z.string(),
  fixes: z.string().optional(),
});
export type Critique = z.infer<typeof Critique>;

export const MAX_STEPS = 4;
export const MAX_REPLANS = 2;
export const MAX_SQL_REGENERATIONS = 2;
export const MAX_CORRECTIVE_CALLS = 1;
/** The writer gets two chances to quote only numbers it was shown before the run fails (Ritik, 2026-10-26); the chart check keeps one. */
export const MAX_PROSE_CORRECTIONS = 2;
/** 240s, not the doc's 60s: a planner call on Opus takes 10-20s and two replans plus tier-3 regenerations must fit. The worker function allows 300s. */
export const RUN_TIME_BUDGET_MS = 240_000;
/** Deadline for one model call. The SDK's timeout covers only the response headers; this covers the body, where generation time goes. 3-4x the slowest healthy call observed (25 s). */
export const PER_CALL_TIMEOUT_MS = 90_000;
/**
 * Lease renewal interval for a running run. ops.redispatch() treats 2 minutes of silence as a dead worker (design 2.1 step 10);
 * 30 s gives it four beats in that window. The timer stops at RUN_TIME_BUDGET_MS so a worker that is alive but stuck falls silent
 * and the cron rescues the run; a last healthy call started inside the budget (at most PER_CALL_TIMEOUT_MS) still ends before the cutoff.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const STATEMENT_TIMEOUT_MS = 5_000;
