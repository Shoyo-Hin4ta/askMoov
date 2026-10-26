import { PERSONA_KEYS } from "@ask-moov/shared";
import { isRunId } from "./run-id";

/**
 * URL state for the /ops indexes. Every value that reaches SQL passes through here: unknown keys and values are dropped,
 * never bound. Pure, no React, no database.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export const RUN_PATHS = ["compiled", "composed", "generated"] as const;
export const SOURCES = ["chat", "eval", "all"] as const;
export type Source = (typeof SOURCES)[number];

export type RunFilters = { status?: string; role?: string; source: Source; path?: string; sha?: string; from?: string; to?: string; q?: string; error: boolean };
export type CallFilters = { node?: string; model?: string; error: boolean; from?: string; to?: string; sha?: string; run?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA = /^[0-9a-f]{1,40}$/;
const TOKEN = /^[a-z0-9._-]+$/;
const CALL_ID = /^\d{1,18}$/;
const SEARCH_MAX = 200;

/** The first value of a key; "" and repeats beyond the first count as absent. */
export function first(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

const oneOf = <T extends readonly string[]>(v: string | undefined, list: T): T[number] | undefined => (v !== undefined && (list as readonly string[]).includes(v) ? v : undefined);
const matching = (v: string | undefined, re: RegExp): string | undefined => (v !== undefined && re.test(v) ? v : undefined);

function validDate(v: string | undefined): string | undefined {
  if (v === undefined || !DATE.test(v)) return undefined;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  return new Date(t).toISOString().slice(0, 10) === v ? v : undefined;
}

export function parseRunFilters(sp: SearchParams): RunFilters {
  return {
    status: oneOf(first(sp, "status"), RUN_STATUSES),
    role: oneOf(first(sp, "role"), PERSONA_KEYS),
    source: oneOf(first(sp, "source"), SOURCES) ?? "chat",
    path: oneOf(first(sp, "path"), RUN_PATHS),
    sha: matching(first(sp, "sha")?.toLowerCase(), SHA),
    from: validDate(first(sp, "from")),
    to: validDate(first(sp, "to")),
    q: first(sp, "q")?.trim().slice(0, SEARCH_MAX) || undefined,
    error: first(sp, "error") === "1",
  };
}

export function parseCallFilters(sp: SearchParams): CallFilters {
  const run = first(sp, "run");
  return {
    node: matching(first(sp, "node"), TOKEN),
    model: matching(first(sp, "model"), TOKEN),
    error: first(sp, "error") === "1",
    from: validDate(first(sp, "from")),
    to: validDate(first(sp, "to")),
    sha: matching(first(sp, "sha")?.toLowerCase(), SHA),
    run: run !== undefined && isRunId(run) ? run : undefined,
  };
}

/** The cursor is the last row's id; the query looks up its timestamp, so no precision is lost on the way through a URL. */
export function runCursor(sp: SearchParams): string | undefined {
  const v = first(sp, "after");
  return v !== undefined && isRunId(v) ? v : undefined;
}

export function callCursor(sp: SearchParams): string | undefined {
  return matching(first(sp, "after"), CALL_ID);
}

/** A YYYY-MM-DD range as UTC instants: from at midnight, to as the start of the next day (exclusive). */
export function utcBounds(from?: string, to?: string): { from?: string; to?: string } {
  const start = (d: string, plusDays = 0) => {
    const [y, m, day] = d.split("-").map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, day + plusDays)).toISOString();
  };
  return { ...(from ? { from: start(from) } : {}), ...(to ? { to: start(to, 1) } : {}) };
}

/** The filters as URL parameters: defaults and absent values are omitted. */
export function runFilterParams(f: RunFilters): Record<string, string | undefined> {
  return { status: f.status, role: f.role, source: f.source === "chat" ? undefined : f.source, path: f.path, sha: f.sha, from: f.from, to: f.to, q: f.q, error: f.error ? "1" : undefined };
}

export function callFilterParams(f: CallFilters): Record<string, string | undefined> {
  return { node: f.node, model: f.model, error: f.error ? "1" : undefined, from: f.from, to: f.to, sha: f.sha, run: f.run };
}

export function hrefWith(path: string, params: Record<string, string | undefined>, cursor?: string): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") usp.set(k, v);
  if (cursor) usp.set("after", cursor);
  const s = usp.toString();
  return s ? `${path}?${s}` : path;
}

/** Make a search term literal inside a LIKE pattern; the default escape character is the backslash. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}
