/** Pure formatting helpers shared by the UI and the viz layer. No React, no DOM. */

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MIDNIGHT = /T00:00:00(\.0+)?(Z|[+-]00:?00)?$/;

export function isNumeric(v: unknown): boolean {
  return typeof v === "number" || (typeof v === "string" && NUMERIC_STRING.test(v));
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && (ISO_DATE.test(v) || ISO_TIMESTAMP.test(v));
}

/** Any cell value as display text. Numbers are grouped, midnight timestamps collapse to the date. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? NUMBER.format(v) : String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return formatLocalDate(v);
  if (typeof v === "string") {
    if (NUMERIC_STRING.test(v)) return NUMBER.format(Number(v));
    if (ISO_TIMESTAMP.test(v)) return formatTimestamp(v);
    return v;
  }
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  return JSON.stringify(v);
}

/** Date objects come from the server's pg driver (ops pages): a `::date` arrives as local midnight, so show local time and drop it when it is midnight. */
function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  return midnight ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimestamp(iso: string): string {
  return MIDNIGHT.test(iso) ? iso.slice(0, 10) : iso.replace("T", " ").slice(0, 16);
}

/** Large standalone figures: 12.9K from 10,000 up, plain grouped digits below. */
export function formatCompact(n: number): string {
  return Math.abs(n) >= 10_000 ? COMPACT.format(n) : NUMBER.format(n);
}

/** Axis and calendar labels: "Oct 6" for ISO dates, otherwise the plain value. */
export function formatDay(v: unknown): string {
  if (!isIsoDate(v)) return formatValue(v);
  return DAY.format(new Date(v.length === 10 ? `${v}T00:00:00Z` : v));
}

export function formatLongDay(isoDate: string): string {
  return LONG_DAY.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function formatRelative(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** snake_case column name as a label: "student_name" to "Student name". */
export function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}
