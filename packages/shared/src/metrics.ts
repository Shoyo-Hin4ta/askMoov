import { z } from "zod";

/**
 * Metric registry. The planner picks from this enum and cannot invent a metric.
 * Adding a metric = one entry here + a compiler column map check + a snapshot test.
 */
export const METRICS = [
  "attendance_rate",
  "present_count",
  "absent_count",
  "scheduled_count",
  "tardy_count",
  "override_count",
  "pass_count",
  "out_minutes",
  "avg_pass_minutes",
  "entry_count",
  "no_card_entries",
  "visits_to_location",
  "students_at_location",
  "dwell_minutes",
  "last_known_location",
  "who_was_where",
  "temp_id_count",
  "device_uptime",
  "device_offline_minutes",
  "my_history",
] as const;
export const Metric = z.enum(METRICS);
export type Metric = z.infer<typeof Metric>;

export const VIEWS = [
  "v_attendance_daily",
  "v_tardies",
  "v_passes",
  "v_entry",
  "v_presence",
  "v_section_roster",
  "v_cards",
  "v_device_uptime",
  "v_my_history",
] as const;
export type View = (typeof VIEWS)[number];

export const ENTITY_TYPES = ["student", "section", "teacher", "room", "wing", "school"] as const;
export const EntityType = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityType>;

export const GROUP_BYS = [
  "student",
  "section",
  "teacher",
  "room",
  "wing",
  "period",
  "day_of_week",
  "week",
  "day",
  "hour_bucket",
  "minute_bucket",
] as const;
export const GroupBy = z.enum(GROUP_BYS);
export type GroupBy = z.infer<typeof GroupBy>;

export const FILTER_KEYS = [
  "destination",
  "day_of_week",
  "period",
  "ab_day",
  "device_type",
  "location",
  "issuer",
  "active_card_type",
  "tardy_kind",
  "status",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Allowed values of the enumerated filters. One source: the Spec schema's enums and the planner prompt both derive from it. */
export const FILTER_VALUES = {
  destination: ["bathroom", "nurse", "office", "library", "counselor", "other"],
  ab_day: ["A", "B"],
  device_type: ["reader", "kiosk", "handheld"],
  issuer: ["tap_out", "teacher", "handheld"],
  active_card_type: ["permanent", "temp"],
  tardy_kind: ["entry", "period"],
  status: ["present", "absent", "tardy"],
} as const;
const filterValues: Partial<Record<FilterKey, readonly string[]>> = FILTER_VALUES;
const describeFilter = (f: FilterKey): string => (filterValues[f] ? `${f} (${filterValues[f].join("|")})` : f);

export const SHAPES = ["scalar", "series", "categories", "grouped", "entity_by_day", "rows"] as const;
export const Shape = z.enum(SHAPES);
export type Shape = z.infer<typeof Shape>;

export type CaveatKind = "inferred_from_next_tap" | "reader_offline_in_window" | "scope_limited" | "no_exit_kiosk" | "no_wing_group";

export type MetricDef = {
  metric: Metric;
  view: View;
  /** One line for the planner prompt. */
  description: string;
  /** "aggregate": one SQL aggregate expression over the view. "rows": a fixed row-returning query compiled per metric. */
  kind: "aggregate" | "rows";
  /** SQL aggregate expression over the view's columns. Only for kind = aggregate. */
  expression?: string;
  groupBy: readonly GroupBy[];
  filters: readonly FilterKey[];
  requiredFilters?: readonly FilterKey[];
  entityTypes: readonly EntityType[];
  needsTimePoint?: boolean;
  caveat?: CaveatKind;
};

const ATTENDED = "status in ('present','tardy')";

export const METRIC_REGISTRY: Record<Metric, MetricDef> = {
  attendance_rate: {
    metric: "attendance_rate",
    view: "v_attendance_daily",
    description: "Share of scheduled meetings attended (present or tardy) over absent + attended. 0 to 1.",
    kind: "aggregate",
    expression: `avg(case when ${ATTENDED} then 1.0 else 0.0 end)`,
    groupBy: ["student", "section", "teacher", "room", "wing", "period", "day_of_week", "week", "day"],
    filters: ["period", "day_of_week", "ab_day"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  present_count: {
    metric: "present_count",
    view: "v_attendance_daily",
    description: "Number of scheduled meetings marked present or tardy.",
    kind: "aggregate",
    expression: `(count(*) filter (where ${ATTENDED}))::int`,
    groupBy: ["student", "section", "teacher", "room", "wing", "period", "day_of_week", "week", "day"],
    filters: ["period", "day_of_week", "ab_day"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  absent_count: {
    metric: "absent_count",
    view: "v_attendance_daily",
    description: "Number of scheduled meetings marked absent.",
    kind: "aggregate",
    expression: "(count(*) filter (where status = 'absent'))::int",
    groupBy: ["student", "section", "teacher", "room", "wing", "period", "day_of_week", "week", "day"],
    filters: ["period", "day_of_week", "ab_day"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  scheduled_count: {
    metric: "scheduled_count",
    view: "v_attendance_daily",
    description: "Number of scheduled meetings (the denominator of attendance_rate).",
    kind: "aggregate",
    expression: "count(*)::int",
    groupBy: ["student", "section", "teacher", "room", "wing", "period", "day_of_week", "week", "day"],
    filters: ["period", "day_of_week", "ab_day"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  tardy_count: {
    metric: "tardy_count",
    view: "v_tardies",
    description: "Number of tardies. tardy_kind = entry (late to building) or period (late to class).",
    kind: "aggregate",
    expression: "count(*)::int",
    groupBy: ["student", "section", "period", "day_of_week", "week", "day"],
    filters: ["tardy_kind", "period", "day_of_week"],
    entityTypes: ["student", "section", "teacher", "school"],
  },
  override_count: {
    metric: "override_count",
    view: "v_attendance_daily",
    description: "Number of attendance rows a teacher changed by hand (source = manual). filters.status = absent counts only overrides to absent.",
    kind: "aggregate",
    expression: "(count(*) filter (where source = 'manual'))::int",
    groupBy: ["student", "section", "teacher", "period", "week", "day"],
    filters: ["period", "day_of_week", "status"],
    entityTypes: ["student", "section", "teacher", "school"],
  },
  pass_count: {
    metric: "pass_count",
    view: "v_passes",
    description: "Number of hall passes.",
    kind: "aggregate",
    expression: "count(*)::int",
    groupBy: ["student", "section", "room", "wing", "period", "day_of_week", "week", "day", "hour_bucket", "minute_bucket"],
    filters: ["destination", "day_of_week", "period", "ab_day", "issuer"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  out_minutes: {
    metric: "out_minutes",
    view: "v_passes",
    description: "Total minutes out of class on passes.",
    kind: "aggregate",
    expression: "coalesce(sum(minutes), 0)",
    groupBy: ["student", "section", "room", "wing", "period", "day_of_week", "week", "day"],
    filters: ["destination", "day_of_week", "period", "ab_day", "issuer"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  avg_pass_minutes: {
    metric: "avg_pass_minutes",
    view: "v_passes",
    description: "Average pass duration in minutes.",
    kind: "aggregate",
    expression: "avg(minutes)",
    groupBy: ["student", "section", "room", "wing", "period", "day_of_week", "week", "day"],
    filters: ["destination", "day_of_week", "period", "ab_day", "issuer"],
    entityTypes: ["student", "section", "teacher", "room", "wing", "school"],
  },
  entry_count: {
    metric: "entry_count",
    view: "v_entry",
    description: "Number of entrance kiosk taps (arrivals at the building). Use this, not visits_to_location, for entrances; group_by minute_bucket shows the morning rush.",
    kind: "aggregate",
    expression: "count(*)::int",
    groupBy: ["student", "day_of_week", "week", "day", "hour_bucket", "minute_bucket"],
    filters: ["day_of_week"],
    entityTypes: ["student", "section", "teacher", "room", "school"],
  },
  no_card_entries: {
    metric: "no_card_entries",
    view: "v_entry",
    description: "Entrance kiosk events where the student had no card (result = no_card).",
    kind: "aggregate",
    expression: "(count(*) filter (where result = 'no_card'))::int",
    groupBy: ["student", "day_of_week", "week", "day"],
    filters: ["day_of_week"],
    entityTypes: ["student", "section", "teacher", "room", "school"],
  },
  visits_to_location: {
    metric: "visits_to_location",
    view: "v_presence",
    description: "Number of arrivals at a location (classroom, cafeteria, gym, library, office).",
    kind: "aggregate",
    expression: "count(*)::int",
    groupBy: ["student", "room", "day_of_week", "week", "day", "hour_bucket", "minute_bucket"],
    filters: ["location", "device_type"],
    entityTypes: ["student", "section", "teacher", "room", "school"],
  },
  students_at_location: {
    metric: "students_at_location",
    view: "v_presence",
    description: "Number of distinct students who arrived at a location at least once (\"how many students tapped into the Gym\"). visits_to_location counts arrivals instead.",
    kind: "aggregate",
    expression: "count(distinct student_id)::int",
    groupBy: ["room", "day_of_week", "week", "day", "hour_bucket", "minute_bucket"],
    filters: ["location", "device_type"],
    entityTypes: ["section", "teacher", "room", "school"],
  },
  dwell_minutes: {
    metric: "dwell_minutes",
    view: "v_presence",
    description: "Minutes between arrival and the next tap elsewhere. Inferred: an upper bound, not a measurement.",
    kind: "aggregate",
    expression: "coalesce(sum(extract(epoch from (left_by - arrived_at)) / 60.0), 0)",
    groupBy: ["student", "room", "week", "day"],
    filters: ["location", "device_type"],
    entityTypes: ["student", "section", "teacher", "room", "school"],
    caveat: "inferred_from_next_tap",
  },
  last_known_location: {
    metric: "last_known_location",
    view: "v_presence",
    description: "Each student's last arrival before time_point. Rows: student_id, location, arrived_at, left_by, left_by_kind.",
    kind: "rows",
    groupBy: [],
    filters: ["device_type"],
    entityTypes: ["student", "section", "teacher", "school"],
    needsTimePoint: true,
    caveat: "inferred_from_next_tap",
  },
  who_was_where: {
    metric: "who_was_where",
    view: "v_presence",
    description: "Students whose last arrival before time_point was at `location` and who had not tapped elsewhere by then. Requires filters.location.",
    kind: "rows",
    groupBy: [],
    filters: ["location"],
    requiredFilters: ["location"],
    entityTypes: ["section", "teacher", "room", "school"],
    needsTimePoint: true,
    caveat: "inferred_from_next_tap",
  },
  temp_id_count: {
    metric: "temp_id_count",
    view: "v_cards",
    description: "Temporary IDs issued in the range.",
    kind: "aggregate",
    expression: "(count(*) filter (where type = 'temp'))::int",
    groupBy: ["student", "week", "day"],
    filters: ["active_card_type"],
    entityTypes: ["student", "section", "teacher", "school"],
  },
  device_uptime: {
    metric: "device_uptime",
    view: "v_device_uptime",
    description: "Share of expected heartbeats received during school hours. 0 to 1. Admin and super_admin only.",
    kind: "aggregate",
    expression: "avg(online_ratio)",
    groupBy: ["room", "day", "hour_bucket"],
    filters: ["device_type"],
    entityTypes: ["room", "school"],
  },
  device_offline_minutes: {
    metric: "device_offline_minutes",
    view: "v_device_uptime",
    description: "Minutes with no heartbeat during school hours. Admin and super_admin only.",
    kind: "aggregate",
    expression: "coalesce(sum(offline_minutes), 0)",
    groupBy: ["room", "day", "hour_bucket"],
    filters: ["device_type"],
    entityTypes: ["room", "school"],
  },
  my_history: {
    metric: "my_history",
    view: "v_my_history",
    description: "Questions the current user asked before, across threads. Recall of what was asked, not evidence about a student. Rows: asked_at, question, entity_type, entity_id, entity_label, metrics, answer_excerpt.",
    kind: "rows",
    groupBy: [],
    filters: [],
    entityTypes: ["student", "section", "teacher", "room"],
  },
};

export function metricDef(metric: Metric): MetricDef {
  return METRIC_REGISTRY[metric];
}

/** Compact registry summary for the planner prompt. Deterministic order so the cached prefix is stable. */
export function describeRegistry(): string {
  return METRICS.map((m) => {
    const d = METRIC_REGISTRY[m];
    const parts = [
      `${m} (${d.view}): ${d.description}`,
      d.groupBy.length ? `group_by: ${d.groupBy.join(", ")}` : "group_by: none (returns rows)",
      d.filters.length ? `filters: ${d.filters.map(describeFilter).join(", ")}` : "filters: none",
      `entity: ${d.entityTypes.join(", ")}`,
      d.needsTimePoint ? "needs time_point" : "",
      d.requiredFilters?.length ? `requires filters.${d.requiredFilters.join(", filters.")}` : "",
    ].filter(Boolean);
    return "- " + parts.join(" | ");
  }).join("\n");
}
