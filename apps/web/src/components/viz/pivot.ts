import { humanize } from "@/lib/format";

/**
 * Pure shaping for grouped results (two dimensions plus a value). Mirrors packages/agent/src/facts.ts seriesColumn,
 * which the client bundle cannot import; the test pins the three branches so the two cannot drift silently.
 */
export type Row = Record<string, unknown>;
export type PivotSeries = { key: string; label: string; empty: boolean };
export type Pivot = { xs: unknown[]; series: PivotSeries[]; data: Row[] };

const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === "";
const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** The legend dimension: fewer distinct values wins; on a tie the one whose values are not all numbers; on a full tie the second column. */
export function seriesColumn(dims: [string, string], rows: Row[]): string {
  const distinct = (d: string) => new Set(rows.map((r) => String(r[d]))).size;
  const [a, b] = dims;
  const da = distinct(a), db = distinct(b);
  if (da !== db) return da < db ? a : b;
  const numeric = (d: string) => rows.every((r) => isEmpty(r[d]) || typeof r[d] === "number");
  if (numeric(a) !== numeric(b)) return numeric(a) ? b : a;
  return b;
}

/** Numbers ascending, otherwise strings A to Z with embedded numbers compared as numbers ("Room 9" before "Room 10"). */
export function naturalCompare(a: unknown, b: unknown): number {
  const na = asNumber(a), nb = asNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function uniqueSorted(values: unknown[]): unknown[] {
  const seen = new Map<string, unknown>();
  for (const v of values) if (!isEmpty(v) && !seen.has(String(v))) seen.set(String(v), v);
  return [...seen.values()].sort(naturalCompare);
}

/**
 * Wide rows for a multi-series chart: one row per x, one stable key per series ("s0", "s1", ...; Recharts reads a
 * dataKey as a property path, so a display value is never used as a key). The empty series ("No wing") sorts last;
 * a missing cell is null, a real 0 stays 0.
 */
export function pivotGrouped(rows: Row[], f: { x: string; series: string; value: string }): Pivot {
  const noX = `No ${humanize(f.x).toLowerCase()}`;
  const xs = uniqueSorted(rows.map((r) => r[f.x]));
  if (rows.some((r) => isEmpty(r[f.x]))) xs.push(noX);
  const seriesValues = uniqueSorted(rows.map((r) => r[f.series]));
  const series: PivotSeries[] = seriesValues.map((v, i) => ({ key: `s${i}`, label: String(v), empty: false }));
  if (rows.some((r) => isEmpty(r[f.series]))) series.push({ key: `s${series.length}`, label: `No ${humanize(f.series).toLowerCase()}`, empty: true });
  const keyOf = (v: unknown) => (isEmpty(v) ? series[series.length - 1]!.key : series[seriesValues.findIndex((s) => String(s) === String(v))]!.key);
  const data: Row[] = xs.map((x) => Object.fromEntries([[f.x, x], ...series.map((s) => [s.key, null])]));
  const byX = new Map(data.map((d) => [String(d[f.x]), d]));
  for (const r of rows) {
    const d = byX.get(isEmpty(r[f.x]) ? noX : String(r[f.x]));
    if (d) d[keyOf(r[f.series])] = asNumber(r[f.value]);
  }
  return { xs, series, data };
}
