import { RefError } from "./errors";

/** What a completed step exposes to later steps. Rows live here only for the current invocation; see execute node. */
export type StepValues = {
  value?: unknown;
  rows?: Record<string, unknown>[];
  row_count?: number;
};

const REF = /^\$([A-Za-z0-9_]+)\.(value|row_count|rows\[(\d+|\*)\]\.([A-Za-z0-9_]+))$/;

export function isRef(x: unknown): x is string {
  return typeof x === "string" && x.startsWith("$");
}

/** Resolve one reference like "$a.value", "$a.rows[0].student_id", "$b.rows[*].pass_count". Throws RefError. */
export function resolveRef(ref: string, results: Record<string, StepValues>): unknown {
  const m = REF.exec(ref);
  if (!m) throw new RefError(`bad reference syntax: ${ref}. Use $step.value, $step.row_count, $step.rows[0].col or $step.rows[*].col`);
  const [, stepId, what, index, column] = m;
  const step = results[stepId!];
  if (!step) {
    const known = Object.keys(results);
    throw new RefError(`unknown step "${stepId}" in ${ref}; available: ${known.length ? known.join(", ") : "none"}`);
  }
  if (what === "value") {
    if (step.value === undefined) throw new RefError(`${ref}: step ${stepId} has no scalar value`);
    return step.value;
  }
  if (what === "row_count") {
    if (step.row_count === undefined) throw new RefError(`${ref}: step ${stepId} has no row_count`);
    return step.row_count;
  }
  const rows = step.rows;
  if (!rows) throw new RefError(`${ref}: step ${stepId} has no rows`);
  if (index === "*") {
    return rows.map((r, i) => pick(r, column!, `${ref} (row ${i})`));
  }
  const i = Number(index);
  const row = rows[i];
  if (!row) throw new RefError(`${ref}: step ${stepId} has ${rows.length} rows, index ${i} is out of range`);
  return pick(row, column!, ref);
}

function pick(row: Record<string, unknown>, column: string, ctx: string): unknown {
  if (!(column in row)) throw new RefError(`${ctx}: no column "${column}"; columns: ${Object.keys(row).join(", ")}`);
  return row[column];
}

/** Walk any JSON value and replace every "$..." string with its resolved value. Non-ref strings pass through. */
export function resolveRefsDeep<T>(input: T, results: Record<string, StepValues>): T {
  if (isRef(input)) return resolveRef(input, results) as T;
  if (Array.isArray(input)) return input.map((v) => resolveRefsDeep(v, results)) as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = resolveRefsDeep(v, results);
    return out as T;
  }
  return input;
}

/** Every step id referenced anywhere in a JSON value. Used by plan validation before anything runs. */
export function referencedSteps(input: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (isRef(v)) {
      const m = REF.exec(v);
      if (!m) throw new RefError(`bad reference syntax: ${v}`);
      found.add(m[1]!);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(input);
  return [...found];
}
