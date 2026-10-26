/**
 * The number gate on what the presenter writes (design 4.9, principle 3). The model never sees the database: it sees the
 * step values, the facts block, a few sample rows, the entities and the question. So a number in its text either rounds
 * to one of those, or the model computed it, which it must never do. Two live answers did exactly that before this gate:
 * "2.3 percentage points" (92.1 minus 89.8) and "1,533 hours" (91,984 minutes divided by 60). Pure functions, no I/O.
 *
 * A written number p matches a shown value a when p is a rounding of a at p's own precision, sign ignored; a 0 to 1 rate
 * may also be written as a percentage. Clock times are compared as minutes of the day, so "9:00", "09:00" and
 * "T09:00:00.000Z" agree and "2:10 pm" reads as 14:10; a bare hour of 1 to 12 reads both ways. An integer under a
 * "hour_bucket" key is also the time H:00. Numbers written as words ("twenty-five") are not checked.
 */

export type Found = { raw: string; value: number; decimals: number; percent: boolean };
export type Allowed = { values: Set<number>; times: Set<number> };
type Clock = { raw: string; minutes: number[] };

const EPSILON = 1e-9;
/** A whole number or a decimal. Thousands groups must be exactly three digits and not run into more ("1203,1204" is two ids). A trailing % or the word percent marks a percentage. */
const NUMBER = /(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?(\s*%|\s*percent(?:age\s+points?)?\b)?/gi;
/** "9:00", "09:00", "09:56:11", "2:10 pm", "12:05 a.m."; seconds are allowed and ignored (a timestamp quoted from a row), the token is never part of a longer digit run. */
const TIME = /(?<![\d:.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])(?:\s*([ap])\.?m\b\.?)?/gi;
/** The clock part of an ISO datetime as JSON writes one; the date part stays for the number pass. */
const ISO_CLOCK = /(?<=\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?Z?/g;
/** "1. First\n2. Second": the markers of a markdown list are not numbers. */
const LIST_MARKER = /^\s*\d+\.\s+/gm;
const ORDINAL = /\b(\d+)(?:st|nd|rd|th)\b/gi;
const HOUR_BUCKET = /"hour_bucket":\s*(\d{1,2})\b/g;

/** Every number and clock time in a text. Times are taken out first so "9:00" is a time, not a 9 and a 0. */
export function extractNumbers(text: string): { numbers: Found[]; times: Clock[] } {
  const times: Clock[] = [];
  let t = text.replace(LIST_MARKER, " ");
  t = t.replace(ISO_CLOCK, (_m, h: string, mm: string) => {
    const minutes = clock(Number(h), Number(mm), null);
    if (minutes) times.push({ raw: `${h}:${mm}`, minutes });
    return " ";
  });
  t = t.replace(TIME, (m, h: string, mm: string, _ss: string | undefined, ap: string | undefined) => {
    const minutes = clock(Number(h), Number(mm), ap ? ap.toLowerCase() : null);
    if (!minutes) return m;
    times.push({ raw: m.trim(), minutes });
    return " ";
  });
  t = t.replace(ORDINAL, "$1");
  const numbers: Found[] = [];
  for (const m of t.matchAll(NUMBER)) {
    const whole = m[1]!.replace(/,/g, "");
    const frac = m[2];
    numbers.push({ raw: m[0].trim(), value: Number(frac ? `${whole}.${frac}` : whole), decimals: frac ? frac.length : 0, percent: Boolean(m[3]) });
  }
  return { numbers, times };
}

/** Minutes of the day for a clock reading, or null when the digits are not one. A bare hour from 1 to 12 reads both ways. */
function clock(h: number, m: number, ap: string | null): number[] | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  if (ap === "p") return [((h % 12) + 12) * 60 + m];
  if (ap === "a") return [(h % 12) * 60 + m];
  if (h >= 1 && h <= 12) return [h * 60 + m, ((h % 12) + 12) * 60 + m];
  return [h * 60 + m];
}

/** The numbers and times the model was shown, from the texts that were in front of it (never the system prompt). */
export function allowedFrom(sources: readonly string[]): Allowed {
  const values = new Set<number>();
  const times = new Set<number>();
  for (const source of sources) {
    const found = extractNumbers(source);
    for (const n of found.numbers) values.add(Math.abs(n.value));
    for (const t of found.times) for (const m of t.minutes) times.add(m);
    for (const m of source.matchAll(HOUR_BUCKET)) times.add(Number(m[1]) * 60);
  }
  return { values, times };
}

/** Null when every number and time in the texts was shown to the model; otherwise the offenders, once each, as written. */
export function proseMismatch(texts: readonly (string | undefined)[], allowed: Allowed): string | null {
  const offenders: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    const found = extractNumbers(text);
    for (const n of found.numbers) if (!matchesNumber(n, allowed.values) && !offenders.includes(n.raw)) offenders.push(n.raw);
    for (const t of found.times) if (!t.minutes.some((m) => allowed.times.has(m)) && !offenders.includes(t.raw)) offenders.push(t.raw);
  }
  return offenders.length ? `not in the results: ${offenders.join(", ")}` : null;
}

/** p is a rounding of some a at p's own precision (half-ties included), or of 100a when p is a percentage. Signs are ignored. */
function matchesNumber(p: Found, values: Set<number>): boolean {
  const tolerance = 0.5 * 10 ** -p.decimals + EPSILON;
  const v = Math.abs(p.value);
  for (const a of values) {
    if (Math.abs(a - v) <= tolerance) return true;
    if (p.percent && Math.abs(a * 100 - v) <= tolerance) return true;
  }
  return false;
}
