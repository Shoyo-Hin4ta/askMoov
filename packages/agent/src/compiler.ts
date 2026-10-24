import {
  DEFAULT_LIMIT, MAX_LIMIT, metricDef,
  type CaveatKind, type EntityType, type FilterKey, type GroupBy, type Persona, type Shape, type Spec, type View,
} from "@ask-moov/shared";
import { PlanValidationError } from "./errors";

/**
 * Spec -> SQL. Pure, deterministic, always parameterized. Same spec, same SQL, byte for byte.
 * Scope predicate is defense in depth; RLS on the base tables is the guarantee.
 */
export type Compiled = { sql: string; params: unknown[]; shape: Shape; caveats: CaveatKind[] };

const ROSTER = "analytics.v_section_roster";

type Pred = (ph: string, many: boolean) => string;
const eq = (col: string): Pred => (ph, many) => (many ? `${col} = ANY(${ph})` : `${col} = ${ph}`);
const inRoster = (col: string, by: string): Pred => (ph, many) =>
  `${col} IN (SELECT ${col} FROM ${ROSTER} WHERE ${by} ${many ? `= ANY(${ph})` : `= ${ph}`})`;

type ViewMap = {
  time: string;
  /** The time column's own type. Range bounds are cast to it: see rangePredicate. */
  timeType: "date" | "timestamptz";
  entity: Partial<Record<EntityType, Pred>>;
  room?: string;
  filters: Partial<Record<FilterKey, string>>;
  teacherScope: Pred | null;
};

/** Views a metric can compile against. v_section_roster has no time column and no metric; lookups read it directly. */
const VIEW_MAP: Partial<Record<View, ViewMap>> = {
  v_attendance_daily: {
    time: "date",
    timeType: "date",
    entity: { student: eq("student_id"), section: eq("section_id"), teacher: eq("teacher_id"), room: eq("room_id"), wing: eq("wing"), school: eq("school_id") },
    room: "room_id",
    filters: { period: "period", ab_day: "ab_day", status: "status" },
    teacherScope: inRoster("section_id", "teacher_id"),
  },
  v_tardies: {
    time: "date",
    timeType: "date",
    entity: { student: eq("student_id"), section: eq("section_id"), teacher: inRoster("section_id", "teacher_id"), school: eq("school_id") },
    filters: { period: "period", tardy_kind: "kind" },
    // entry tardies carry no section_id (kiosk taps). RLS is by student on entry_events and by section on attendance,
    // so the student predicate is the superset that RLS narrows; a section predicate would hide every entry tardy.
    teacherScope: inRoster("student_id", "teacher_id"),
  },
  v_passes: {
    time: "started_at",
    timeType: "timestamptz",
    entity: { student: eq("student_id"), section: eq("section_id"), teacher: inRoster("section_id", "teacher_id"), room: eq("origin_room_id"), wing: eq("wing"), school: eq("school_id") },
    room: "origin_room_id",
    filters: { destination: "destination", period: "period", ab_day: "ab_day", issuer: "issuer" },
    teacherScope: inRoster("section_id", "teacher_id"),
  },
  v_entry: {
    time: "ts",
    timeType: "timestamptz",
    entity: { student: eq("student_id"), section: inRoster("student_id", "section_id"), teacher: inRoster("student_id", "teacher_id"), room: eq("location_id"), school: eq("school_id") },
    room: "location_id",
    filters: {},
    teacherScope: inRoster("student_id", "teacher_id"),
  },
  v_presence: {
    time: "arrived_at",
    timeType: "timestamptz",
    entity: { student: eq("student_id"), section: inRoster("student_id", "section_id"), teacher: inRoster("student_id", "teacher_id"), room: eq("location_id"), school: eq("school_id") },
    room: "location_id",
    filters: { location: "location", device_type: "device_type" },
    teacherScope: inRoster("student_id", "teacher_id"),
  },
  v_cards: {
    time: "issued_at",
    timeType: "timestamptz",
    entity: { student: eq("student_id"), section: inRoster("student_id", "section_id"), teacher: inRoster("student_id", "teacher_id"), school: eq("school_id") },
    filters: { active_card_type: "active_card_type" },
    teacherScope: inRoster("student_id", "teacher_id"),
  },
  v_device_uptime: {
    time: "hour",
    timeType: "timestamptz",
    entity: { room: eq("room_id"), school: eq("school_id") },
    room: "room_id",
    filters: { device_type: "device_type" },
    teacherScope: () => "false",
  },
  v_my_history: {
    time: "asked_at",
    timeType: "timestamptz",
    entity: {},
    filters: {},
    teacherScope: null,
  },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/**
 * Range bounds are cast to the time column's own type. A cross-type comparison (timestamptz >= date) is not leakproof,
 * and under row-level security Postgres evaluates a non-leakproof predicate only after the policy, so it can never be an
 * index condition: the Gym count read all 9292 arrivals for the room and filtered 9041 away (2074 ms, a timeout under load).
 * Same-type operators are leakproof and reach the index (0.4 ms). Semantics are identical: a date bound was already being
 * cast to timestamptz at midnight in the session time zone.
 */
function rangePredicate(view: ViewMap, start: string, end: string): string {
  return view.timeType === "date"
    ? `${view.time} >= ${start}::date AND ${view.time} < (${end}::date + 1)`
    : `${view.time} >= ${start}::timestamptz AND ${view.time} < (${end}::date + 1)::timestamptz`;
}

export function compile(spec: Spec, persona: Persona): Compiled {
  const def = metricDef(spec.metric);
  const view = VIEW_MAP[def.view];
  if (!view) throw new PlanValidationError(`${spec.metric} reads ${def.view}, which has no compiler mapping`);
  const groupBy = spec.group_by ?? [];
  const filters = spec.filters ?? {};
  const caveats: CaveatKind[] = [];

  for (const g of groupBy) if (!def.groupBy.includes(g)) throw new PlanValidationError(`${spec.metric} cannot group by ${g}; allowed: ${def.groupBy.join(", ") || "none"}`);
  for (const k of Object.keys(filters) as FilterKey[]) {
    if (filters[k] === undefined) continue;
    if (!def.filters.includes(k)) throw new PlanValidationError(`${spec.metric} does not accept filter ${k}; allowed: ${def.filters.join(", ") || "none"}`);
  }
  for (const k of def.requiredFilters ?? []) if (filters[k] === undefined) throw new PlanValidationError(`${spec.metric} requires filters.${k}`);
  if (spec.entity && !def.entityTypes.includes(spec.entity.type)) throw new PlanValidationError(`${spec.metric} does not accept entity type ${spec.entity.type}; allowed: ${def.entityTypes.join(", ")}`);
  if (def.needsTimePoint && !spec.time_point) throw new PlanValidationError(`${spec.metric} requires time_point`);
  if (!DATE.test(spec.time_range.start) || !DATE.test(spec.time_range.end)) throw new PlanValidationError(`time_range must be ISO dates YYYY-MM-DD, got ${spec.time_range.start}..${spec.time_range.end}`);
  if (spec.time_range.start > spec.time_range.end) throw new PlanValidationError("time_range.start is after time_range.end");
  const limit = Math.min(spec.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  if (limit < 1) throw new PlanValidationError("limit must be at least 1");

  const p = new Params();
  const where: string[] = [];

  where.push(rangePredicate(view, p.add(spec.time_range.start), p.add(spec.time_range.end)));

  if (spec.entity) {
    if (def.view === "v_my_history") {
      const ids = Array.isArray(spec.entity.id) ? spec.entity.id.map(String) : [String(spec.entity.id)];
      where.push(`entity_type = ${p.add(spec.entity.type)} AND entity_id = ANY(${p.add(ids)})`);
    } else {
      const pred = view.entity[spec.entity.type];
      if (!pred) throw new PlanValidationError(`${def.view} has no way to filter by ${spec.entity.type}`);
      const many = Array.isArray(spec.entity.id);
      where.push(pred(p.add(spec.entity.id), many));
    }
  }

  for (const [k, v] of Object.entries(filters) as [FilterKey, unknown][]) {
    if (v === undefined) continue;
    if (k === "location" && spec.metric === "who_was_where") continue; // applied after DISTINCT ON, see rowsQuery
    // one value or a list mean the same thing (Filters in shared); a one-element list compiles like the value
    const values = Array.isArray(v) ? v : [v];
    if (values.length === 0) throw new PlanValidationError(`filter ${k} is an empty list`);
    if (k === "day_of_week") { where.push(`extract(isodow from ${view.time})::int = ANY(${p.add(values)})`); continue; }
    const col = view.filters[k];
    if (!col) throw new PlanValidationError(`${def.view} has no column for filter ${k}`);
    where.push(values.length === 1 ? `${col} = ${p.add(values[0])}` : `${col} = ANY(${p.add(values)})`);
  }

  if (def.view !== "v_my_history") {
    if (persona.role === "teacher" && view.teacherScope) { where.push(view.teacherScope(p.add(persona.user_id), false)); caveats.push("scope_limited"); }
    if (persona.role === "admin") where.push(`school_id = ${p.add(persona.school_id)}`);
  }
  if (def.caveat) caveats.push(def.caveat);
  // rooms outside the wings (gym, cafeteria, library, offices, entrances) have a null wing; the reader must be told what that group is
  if (groupBy.includes("wing")) caveats.push("no_wing_group");

  const from = `analytics.${def.view}`;
  const whereSql = where.join("\n  AND ");

  if (def.kind === "rows") {
    return { ...rowsQuery(spec, def.view, from, whereSql, p, limit), caveats };
  }

  const dims = groupBy.map((g) => `${groupExpr(g, view)} AS ${g}`);
  const select = [...dims, `${def.expression} AS value`].join(",\n  ");
  const groupSql = groupBy.length ? `\nGROUP BY ${groupBy.map((_, i) => i + 1).join(", ")}` : "";
  // A filtered count grouped by entities lists only the groups that have what it counts: "which students did she override"
  // must not return every student with an absent row and a 0 (2026-10-24: the critic refused exactly that once it could see
  // the minimum and the total). Time buckets keep their zeros so a series has no gaps.
  const dropZeroGroups = def.expression !== undefined && FILTERED_COUNT.test(def.expression)
    && groupBy.some((g) => ENTITY_DIMS.includes(g)) && !groupBy.some((g) => TIME_BUCKETS.includes(g));
  const havingSql = dropZeroGroups ? `\nHAVING ${def.expression} > 0` : "";
  const orderSql = `\nORDER BY ${orderClause(spec, groupBy)}`;
  const sql = `SELECT\n  ${select}\nFROM ${from}\nWHERE ${whereSql}${groupSql}${havingSql}${orderSql}\nLIMIT ${limit}`;
  return { sql, params: p.values, shape: shapeOf(spec, groupBy), caveats };
}

function groupExpr(g: GroupBy, view: ViewMap): string {
  const t = view.time;
  switch (g) {
    case "student": return "student_id";
    case "section": return "section_id";
    case "teacher": return "teacher_id";
    case "room": return view.room ?? "room_id";
    case "wing": return "wing";
    case "period": return "period";
    case "day_of_week": return `extract(isodow from ${t})::int`;
    case "week": return `date_trunc('week', ${t})::date`;
    case "day": return `(${t})::date`;
    case "hour_bucket": return `extract(hour from ${t})::int`;
    case "minute_bucket": return `to_char(date_trunc('hour', ${t}) + make_interval(mins => (extract(minute from ${t})::int / 5) * 5), 'HH24:MI')`;
  }
}

const TIME_BUCKETS: readonly GroupBy[] = ["week", "day", "hour_bucket", "minute_bucket"];
const ENTITY_DIMS: readonly GroupBy[] = ["student", "section", "teacher", "room", "wing"];
/** A registry expression that counts a subset of the view's rows (present, absent, manual, no_card, temp). */
const FILTERED_COUNT = /count\(\*\) filter \(where/i;

function orderClause(spec: Spec, groupBy: GroupBy[]): string {
  if (spec.order) {
    const by = spec.order.by;
    if (by !== "value" && !groupBy.includes(by as GroupBy)) throw new PlanValidationError(`order.by must be "value" or one of group_by (${groupBy.join(", ") || "none"}), got ${by}`);
    return `${by} ${spec.order.dir.toUpperCase()}`;
  }
  const bucket = groupBy.find((g) => TIME_BUCKETS.includes(g));
  if (bucket) return `${bucket} ASC`;
  return groupBy.length ? "value DESC" : "1";
}

function shapeOf(spec: Spec, groupBy: GroupBy[]): Shape {
  if (groupBy.length === 0) return "scalar";
  const isDayCalendar = groupBy.includes("day") && (groupBy.length === 1 ? spec.entity?.type === "student" : groupBy.length === 2 && groupBy.includes("student"));
  if (isDayCalendar) return "entity_by_day";
  if (groupBy.length === 1) return TIME_BUCKETS.includes(groupBy[0]!) ? "series" : "categories";
  // two categories ("by wing, by period") draw as a grouped bar; a category over time stays a table until there is a grouped line
  if (groupBy.length === 2 && !groupBy.some((g) => TIME_BUCKETS.includes(g))) return "grouped";
  return "rows";
}

function rowsQuery(spec: Spec, viewName: View, from: string, whereSql: string, p: Params, limit: number): Omit<Compiled, "caveats"> {
  switch (spec.metric) {
    case "last_known_location": {
      const tp = p.add(spec.time_point);
      const sql = `SELECT DISTINCT ON (student_id)\n  student_id, location, location_kind, arrived_at, left_by, left_by_kind\nFROM ${from}\nWHERE arrived_at <= ${tp}\n  AND ${whereSql}\nORDER BY student_id, arrived_at DESC\nLIMIT ${limit}`;
      return { sql, params: p.values, shape: "rows" };
    }
    case "who_was_where": {
      const tp = p.add(spec.time_point);
      // location is matched after DISTINCT ON so "last arrival" is computed over every location first.
      const loc = spec.filters?.location;
      const sql = `SELECT student_id, location, arrived_at, left_by, left_by_kind\nFROM (\n  SELECT DISTINCT ON (student_id) student_id, location, arrived_at, left_by, left_by_kind\n  FROM ${from}\n  WHERE arrived_at <= ${tp}\n    AND ${whereSql}\n  ORDER BY student_id, arrived_at DESC\n) last\nWHERE location = ${p.add(loc)}\n  AND (left_by IS NULL OR left_by > ${tp})\nORDER BY arrived_at DESC\nLIMIT ${limit}`;
      return { sql, params: p.values, shape: "rows" };
    }
    case "my_history": {
      // One row per question. v_my_history has one row per (run, resolved entity), so a question that named two people
      // appeared twice and the critic rightly refused the list (2026-10-24). The entity filter in whereSql still applies per row.
      const sql = `SELECT run_id, thread_id, min(asked_at) AS asked_at, question, string_agg(DISTINCT entity_label, ', ' ORDER BY entity_label) AS entities, metrics, answer_excerpt\nFROM ${from}\nWHERE ${whereSql}\nGROUP BY run_id, thread_id, question, metrics, answer_excerpt\nORDER BY asked_at DESC\nLIMIT ${limit}`;
      return { sql, params: p.values, shape: "rows" };
    }
    default:
      throw new PlanValidationError(`no row query defined for ${spec.metric} on ${viewName}`);
  }
}
