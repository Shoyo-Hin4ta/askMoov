import { z } from "zod";
import { EntityType, FILTER_VALUES, GroupBy, Metric } from "./metrics";

/**
 * Structured query spec. The planner fills this; the compiler turns it into SQL.
 * Kept free of regex/min/max/defaults so the JSON schema sent to the model stays plain;
 * limits (dates well-formed, limit <= 500, metric/group_by pairing) are enforced in code by validatePlan().
 */
/**
 * A factory, not a shared instance: the SDK turns any Zod instance used twice into a $defs reference,
 * and the API rejects $defs on a union root (the planner output). Each call inlines a fresh schema.
 *
 * Every object here is strict: a key the schema does not know (a hallucinated filter, a field from an older spec) is a parse
 * error that gets the planner's one corrective call, not a silent drop that runs a different query than the model meant.
 * 194 stored plans carried zero unknown keys (2026-10-23), so strictness costs nothing in corrective calls.
 */
export const entityId = () => z.union([z.number(), z.string()]);
export type EntityId = number | string;

export const EntityRef = z.strictObject({
  type: EntityType,
  /** An id returned by lookup_entity in this run or pinned in this thread, or a "$step.rows[*].col" reference. */
  id: z.union([entityId(), z.array(entityId())]),
});
export type EntityRef = z.infer<typeof EntityRef>;

/**
 * Every filter takes one value or a list. The planner writes `period: 6` as often as `period: [6]`, and when told
 * "expected array" it turned `destination` into a list too (2026-10-24, two eval runs lost to that). The compiler emits
 * `= $n` for one value and `= ANY($n)` for a list, so both forms mean the same query; only unknown values are rejected.
 */
const oneOrMany = <const T extends readonly [string, ...string[]]>(values: T) => z.union([z.enum(values), z.array(z.enum(values))]);
const intOrInts = () => z.union([z.number().int(), z.array(z.number().int())]);

export const Filters = z.strictObject({
  destination: oneOrMany(FILTER_VALUES.destination).optional(),
  day_of_week: intOrInts().optional(),
  period: intOrInts().optional(),
  ab_day: oneOrMany(FILTER_VALUES.ab_day).optional(),
  device_type: oneOrMany(FILTER_VALUES.device_type).optional(),
  location: z.string().optional(),
  issuer: oneOrMany(FILTER_VALUES.issuer).optional(),
  active_card_type: oneOrMany(FILTER_VALUES.active_card_type).optional(),
  tardy_kind: oneOrMany(FILTER_VALUES.tardy_kind).optional(),
  status: oneOrMany(FILTER_VALUES.status).optional(),
});
export type Filters = z.infer<typeof Filters>;

export const TimeRange = z.strictObject({
  start: z.string(),
  end: z.string(),
});
export type TimeRange = z.infer<typeof TimeRange>;

export const Spec = z.strictObject({
  metric: Metric,
  entity: EntityRef.optional(),
  filters: Filters.optional(),
  time_range: TimeRange,
  time_point: z.string().optional(),
  group_by: z.array(GroupBy).optional(),
  order: z.strictObject({ by: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().optional(),
});
export type Spec = z.infer<typeof Spec>;

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
