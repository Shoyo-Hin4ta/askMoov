import type { Shape } from "@ask-moov/shared";
import type { Row } from "./deps";
import { ID_COLUMNS } from "./labels";

/**
 * Facts code computes over a step's full result for the critic and the presenter. They see only a few sample rows, chosen by
 * SQL order, so without this a time series was described by its first five buckets and a grouped result by its five largest
 * rows (2026-10-24: the Entrance 2 answer never named its peak). Principle 3: the model reads numbers, it does not derive them.
 */
export type Facts = {
  /** The numeric column the facts are about, or null when the rows carry no number. */
  value_column: string | null;
  /** Only when summing the value is meaningful (counts and sums, not averages, rates or distinct counts). */
  total?: number;
  max?: Row;
  min?: Row;
  /** Time series: the first and last bucket in order. */
  first?: Row;
  last?: Row;
  /** Grouped results: the dimension with fewer distinct values, and the highest row within each of its values. */
  series_column?: string;
  top_per_series?: Record<string, Row>;
  /** Rows whose dimension is empty, per dimension column (e.g. { wing: 8 }). */
  empty?: Record<string, number>;
};

const TIME_COLUMNS = new Set(["week", "day", "hour_bucket", "minute_bucket"]);
const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === "";
/** An id is numeric but never the measured value. */
const isIdColumn = (c: string): boolean => c === "id" || c.endsWith("_id") || c in ID_COLUMNS;

/**
 * Which of two dimensions is the series (the legend) of a grouped result: the one with fewer distinct values; on a tie the
 * non-numeric one (wings over periods); on a full tie the second column. The renderer applies the same rule.
 */
export function seriesColumn(dims: [string, string], rows: Row[]): string {
  const distinct = (d: string) => new Set(rows.map((r) => String(r[d]))).size;
  const [a, b] = dims;
  const da = distinct(a), db = distinct(b);
  if (da !== db) return da < db ? a : b;
  const numeric = (d: string) => rows.every((r) => isEmpty(r[d]) || typeof r[d] === "number");
  if (numeric(a) !== numeric(b)) return numeric(a) ? b : a;
  return b;
}

export function stepFacts(columns: string[], rows: Row[], shape: Shape | undefined, summable: boolean): Facts {
  const valueColumn = columns.includes("value") ? "value" : columns.find((c) => !isIdColumn(c) && rows.some((r) => typeof r[c] === "number")) ?? null;
  const facts: Facts = { value_column: valueColumn };
  if (rows.length === 0) return facts;

  const dims = columns.filter((c) => c !== valueColumn);
  const empty: Record<string, number> = {};
  for (const d of dims) {
    const n = rows.filter((r) => isEmpty(r[d])).length;
    if (n > 0) empty[d] = n;
  }
  if (Object.keys(empty).length > 0) facts.empty = empty;
  if (!valueColumn) return facts;

  const numeric = rows.filter((r) => typeof r[valueColumn] === "number");
  if (numeric.length === 0) return facts;
  const v = (r: Row): number => r[valueColumn] as number;
  if (summable) facts.total = Math.round(numeric.reduce((a, r) => a + v(r), 0) * 1000) / 1000;
  facts.max = numeric.reduce((a, r) => (v(r) > v(a) ? r : a));
  facts.min = numeric.reduce((a, r) => (v(r) < v(a) ? r : a));

  if (shape === "series" || dims.some((d) => TIME_COLUMNS.has(d))) {
    facts.first = rows[0];
    facts.last = rows[rows.length - 1];
  }

  if (dims.length === 2 && shape !== "entity_by_day") {
    const series = seriesColumn([dims[0]!, dims[1]!], rows);
    const top: Record<string, Row> = {};
    for (const r of numeric) {
      const key = isEmpty(r[series]) ? "(none)" : String(r[series]);
      if (!top[key] || v(r) > v(top[key]!)) top[key] = r;
    }
    facts.series_column = series;
    facts.top_per_series = top;
  }
  return facts;
}

/** Whether a registry expression sums cleanly across rows: counts and sums do; averages, rates and distinct counts do not. */
export function isSummable(expression: string | undefined): boolean {
  if (!expression) return false;
  const e = expression.trim().toLowerCase();
  if (e.startsWith("count(distinct") || e.startsWith("(count(distinct")) return false;
  return e.startsWith("count(") || e.startsWith("(count(") || e.startsWith("sum(") || e.startsWith("coalesce(sum(");
}
