import type { EntityType } from "@ask-moov/shared";
import type { Row } from "./deps";

/**
 * Names for the ids in a result. The analytics views carry ids only (joining the name tables into big views was a
 * performance trap), so code resolves them afterwards through analytics.v_entities as the asking persona: row-level security
 * on that view means a persona only ever gets labels for entities it may see. Stored with the run output for the UI
 * ({ column: { id: label } }) and shown to the critic and the presenter as "Name (id)".
 */
export type Labels = Record<string, Record<string, string>>;
export type LabelQuery = (sql: string, params: unknown[]) => Promise<Row[]>;

/** Result columns that hold an entity id, and the entity type each resolves through. */
export const ID_COLUMNS: Record<string, EntityType> = {
  student: "student", student_id: "student",
  section: "section", section_id: "section",
  teacher: "teacher", teacher_id: "teacher",
  room: "room", room_id: "room", origin_room_id: "room", location_id: "room",
};

export async function entityLabels(query: LabelQuery, columns: string[], rows: Row[]): Promise<Labels> {
  const idColumns = columns.filter((c) => c in ID_COLUMNS);
  const idsByType = new Map<EntityType, Set<string>>();
  for (const c of idColumns) {
    const type = ID_COLUMNS[c]!;
    const ids = idsByType.get(type) ?? new Set<string>();
    for (const r of rows) { const v = r[c]; if (v !== null && v !== undefined && v !== "") ids.add(String(v)); }
    idsByType.set(type, ids);
  }
  const found = new Map<EntityType, Record<string, string>>();
  for (const [type, ids] of idsByType) {
    if (ids.size === 0) continue;
    const res = await query("SELECT id, label FROM analytics.v_entities WHERE type = $1 AND id = ANY($2::text[])", [type, [...ids]]);
    const map: Record<string, string> = {};
    for (const r of res) if (r["id"] !== undefined && r["label"] !== undefined) map[String(r["id"])] = String(r["label"]);
    if (Object.keys(map).length > 0) found.set(type, map);
  }
  const out: Labels = {};
  for (const c of idColumns) { const map = found.get(ID_COLUMNS[c]!); if (map) out[c] = map; }
  return out;
}

/** Rows for the model: an id becomes "Name (id)", so prose can use the name and the id stays traceable. Unknown ids are left alone. */
export function withLabels(rows: Row[], labels: Labels): Row[] {
  const cols = Object.keys(labels);
  if (cols.length === 0) return rows;
  return rows.map((r) => {
    const o: Row = { ...r };
    for (const c of cols) {
      const v = r[c];
      const label = v === null || v === undefined ? undefined : labels[c]![String(v)];
      if (label) o[c] = `${label} (${v})`;
    }
    return o;
  });
}

/** Merge per-step label maps into one map for the run output. */
export function mergeLabels(into: Labels, more: Labels): Labels {
  for (const [c, m] of Object.entries(more)) into[c] = { ...(into[c] ?? {}), ...m };
  return into;
}
