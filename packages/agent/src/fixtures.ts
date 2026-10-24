import type { Persona, Spec } from "@ask-moov/shared";

/** Test-only. One representative spec per metric, plus the three personas. */
export const PERSONAS: Persona[] = [
  { role: "teacher", user_id: 17, school_id: 1, scope_summary: "teacher 17" },
  { role: "admin", user_id: 3, school_id: 1, scope_summary: "admin of school 1" },
  { role: "super_admin", user_id: 1, school_id: 1, scope_summary: "district" },
];

const range = { start: "2026-09-14", end: "2026-10-13" };

export const REPRESENTATIVE_SPECS: Record<string, Spec> = {
  attendance_rate_section: { metric: "attendance_rate", entity: { type: "section", id: 42 }, time_range: range },
  attendance_rate_by_week: { metric: "attendance_rate", entity: { type: "student", id: 1203 }, time_range: range, group_by: ["week"] },
  present_count_calendar: { metric: "present_count", entity: { type: "student", id: 1203 }, time_range: range, group_by: ["day"] },
  absent_count: { metric: "absent_count", entity: { type: "section", id: 42 }, time_range: range },
  scheduled_count: { metric: "scheduled_count", entity: { type: "student", id: 1203 }, time_range: range },
  tardy_count_by_week: { metric: "tardy_count", entity: { type: "student", id: 1203 }, time_range: range, group_by: ["week"], filters: { tardy_kind: "entry" } },
  override_count: { metric: "override_count", entity: { type: "teacher", id: 17 }, time_range: range, group_by: ["student"], order: { by: "value", dir: "desc" }, limit: 10 },
  pass_count_by_period_wing: { metric: "pass_count", time_range: range, group_by: ["period", "wing"], filters: { destination: "bathroom" } },
  pass_count_ab: { metric: "pass_count", entity: { type: "student", id: 1203 }, time_range: range, filters: { ab_day: "A", day_of_week: [2] } },
  out_minutes_top: { metric: "out_minutes", time_range: range, group_by: ["student"], order: { by: "value", dir: "desc" }, limit: 10 },
  avg_pass_minutes_week: { metric: "avg_pass_minutes", entity: { type: "student", id: 1203 }, time_range: range, group_by: ["week"], filters: { destination: "bathroom" } },
  entry_count_minute: { metric: "entry_count", time_range: range, group_by: ["minute_bucket"] },
  no_card_entries: { metric: "no_card_entries", entity: { type: "student", id: 1203 }, time_range: range },
  visits_to_location: { metric: "visits_to_location", time_range: range, filters: { location: "Gym" }, group_by: ["student"] },
  students_at_location: { metric: "students_at_location", entity: { type: "room", id: 185 }, time_range: { start: "2026-10-12", end: "2026-10-12" } },
  dwell_minutes: { metric: "dwell_minutes", entity: { type: "student", id: 1203 }, time_range: range, group_by: ["room"] },
  last_known_location: { metric: "last_known_location", entity: { type: "student", id: 1203 }, time_range: range, time_point: "2026-10-13T10:40:00Z" },
  who_was_where: { metric: "who_was_where", time_range: range, time_point: "2026-10-13T14:10:00Z", filters: { location: "Gym" } },
  temp_id_count: { metric: "temp_id_count", entity: { type: "student", id: 1203 }, time_range: range },
  device_uptime: { metric: "device_uptime", entity: { type: "room", id: 214 }, time_range: { start: "2026-10-06", end: "2026-10-06" }, group_by: ["hour_bucket"] },
  device_offline_minutes: { metric: "device_offline_minutes", entity: { type: "room", id: 214 }, time_range: range, group_by: ["day"] },
  my_history: { metric: "my_history", entity: { type: "student", id: 1203 }, time_range: range },
  entity_list_ref_resolved: { metric: "attendance_rate", entity: { type: "student", id: [1203, 1204, 1205] }, time_range: range, group_by: ["student"] },
};
