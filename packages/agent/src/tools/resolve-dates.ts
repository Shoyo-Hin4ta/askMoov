import { z } from "zod";

/**
 * Dates: the model understands the phrase and fills this structure; code does the calendar math.
 * "today" is the frozen now from ops.schema_meta, never the wall clock. Returns school days only.
 * The only error left is a structure that contains no school day (e.g. "last week" over a break).
 */
export const DateQuery = z.object({
  /** The words from the question, kept for pinning and templatizing. */
  phrase: z.string(),
  kind: z.enum(["today", "yesterday", "relative", "month", "since", "range", "school_year"]),
  /** relative only */
  unit: z.enum(["day", "week", "month"]).nullable().optional(),
  count: z.number().int().nullable().optional(),
  anchor: z.enum(["this", "last"]).nullable().optional(),
  /** month only: 1..12, year optional (defaults to the current school year) */
  month: z.number().int().nullable().optional(),
  year: z.number().int().nullable().optional(),
  /** since and range: ISO dates YYYY-MM-DD */
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
  /** ISO weekdays to keep, 1 = Monday .. 5 = Friday ("Tuesdays in September") */
  weekdays: z.array(z.number().int()).nullable().optional(),
  /** data (default): the frozen now and school days. history: the real clock and every calendar day (ops.runs is stamped in real time). The plan node picks the calendar; the structure is the same. */
  clock: z.enum(["data", "history"]).nullable().optional(),
});
export type DateQuery = z.infer<typeof DateQuery>;

export type SchoolDays = (start: string, end: string) => Promise<string[]>;
export type ResolvedDates = { start: string; end: string; label: string; day_of_week?: number[] };

/** Every calendar day in the range, for history questions: past questions were asked on real days, not school days. */
export const everyDay: SchoolDays = async (start, end) => {
  const out: string[] = [];
  for (let d = parseIso(start); d <= parseIso(end); d = addDays(d, 1)) out.push(iso(d));
  return out;
};

export class DateResolutionError extends Error {}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function resolveDates(input: unknown, today: string, schoolDays: SchoolDays): Promise<ResolvedDates> {
  const parsed = DateQuery.safeParse(input);
  if (!parsed.success) throw new DateResolutionError(`bad date query: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const q = parsed.data;
  const now = parseIso(today);
  let start: Date, end: Date, label: string;

  switch (q.kind) {
    case "today": start = end = now; label = "today"; break;
    case "yesterday": {
      const days = await schoolDays(iso(addDays(now, -14)), iso(addDays(now, -1)));
      const last = days[days.length - 1];
      if (!last) throw new DateResolutionError("no school day in the two weeks before today");
      return { start: last, end: last, label: "yesterday (last school day)" };
    }
    case "relative": {
      const unit = q.unit ?? "week";
      const anchor = q.anchor ?? "last";
      const n = Math.max(1, q.count ?? 1);
      if (unit === "day") {
        start = anchor === "this" ? now : addDays(now, -(n - 1)); end = now;
        label = anchor === "this" ? "today" : `last ${n} days`;
      } else if (unit === "week") {
        const mon = monday(now);
        if (anchor === "this") { start = mon; end = now; label = "this week"; }
        else { start = addDays(mon, -7 * n); end = addDays(mon, -1); label = n === 1 ? "last week" : `last ${n} weeks`; }
      } else {
        const first = firstOfMonth(now);
        if (anchor === "this") { start = first; end = now; label = "this month"; }
        else { start = addMonths(first, -n); end = addDays(first, -1); label = n === 1 ? "last month" : `last ${n} months`; }
      }
      break;
    }
    case "month": {
      if (!q.month || q.month < 1 || q.month > 12) throw new DateResolutionError("month must be 1..12");
      const mi = q.month - 1;
      const year = q.year ?? (mi > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
      start = new Date(Date.UTC(year, mi, 1)); end = new Date(Date.UTC(year, mi + 1, 0));
      label = `${MONTHS[mi]} ${year}`;
      break;
    }
    case "since": {
      if (!q.start || !ISO.test(q.start)) throw new DateResolutionError("since needs start as YYYY-MM-DD");
      start = parseIso(q.start); end = now; label = `since ${q.start}`;
      break;
    }
    case "range": {
      if (!q.start || !ISO.test(q.start) || !q.end || !ISO.test(q.end)) throw new DateResolutionError("range needs start and end as YYYY-MM-DD");
      start = parseIso(q.start); end = parseIso(q.end); label = `${q.start} to ${q.end}`;
      break;
    }
    case "school_year": start = new Date(Date.UTC(1970, 0, 1)); end = now; label = "this school year"; break;
  }

  if (end > now) end = now;
  if (start > end) throw new DateResolutionError(`"${q.phrase}" resolves to a range that starts after it ends (${iso(start)} > ${iso(end)})`);

  const days = await schoolDays(iso(start), iso(end));
  const dow = q.weekdays?.length ? q.weekdays : undefined;
  const kept = dow ? days.filter((d) => dow.includes(isoDow(parseIso(d)))) : days;
  if (kept.length === 0) throw new DateResolutionError(`no school days for "${q.phrase}" (${iso(start)} to ${iso(end)}${dow ? `, weekdays ${dow.join(",")}` : ""})`);
  return { start: kept[0]!, end: kept[kept.length - 1]!, label, ...(dow ? { day_of_week: dow } : {}) };
}

function parseIso(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new DateResolutionError(`bad ISO date ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
export function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * 86_400_000); }
function addMonths(d: Date, n: number): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }
function isoDow(d: Date): number { return ((d.getUTCDay() + 6) % 7) + 1; }
function monday(d: Date): Date { return addDays(d, -(isoDow(d) - 1)); }
function firstOfMonth(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
