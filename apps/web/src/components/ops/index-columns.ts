import type { Column } from "@/components/ui/data-table";
import { EMPTY_CELL, formatDuration, formatValue } from "@/lib/format";
import { formatTimestamp, formatUsd } from "@/lib/trace";

/** Column builders shared by the run and call indexes. Pure. */
const QUESTION_MAX = 80;

export const col = (key: string, label: string, format: Column["format"], align: Column["align"] = "left"): Column => ({ key, label, align, kind: "text", format });

export const text = (v: unknown) => ({ text: v === null || v === undefined || v === "" ? EMPTY_CELL : String(v) });
export const number = (v: unknown) => ({ text: typeof v === "number" ? formatValue(v) : EMPTY_CELL });
export const utc = (v: unknown) => ({ text: v instanceof Date || typeof v === "string" ? formatTimestamp(v) : EMPTY_CELL });
export const duration = (v: unknown) => ({ text: typeof v === "number" ? formatDuration(v) : EMPTY_CELL });
export const usd = (v: unknown) => ({ text: typeof v === "number" ? formatUsd(v) : EMPTY_CELL });
export const yesNo = (v: unknown) => ({ text: v ? "yes" : "no" });
export const sha = (v: unknown) => (typeof v === "string" && v ? { text: v.slice(0, 8), title: v } : { text: EMPTY_CELL });
export const runLink = (v: unknown) => (typeof v === "string" && v ? { text: v.slice(0, 8), title: v, href: `/ops/runs/${v}` } : { text: EMPTY_CELL });
export const question = (href?: (row: Record<string, unknown>) => string) => (v: unknown, row?: Record<string, unknown>) => {
  const s = typeof v === "string" ? v : "";
  const cut = s.length > QUESTION_MAX ? `${s.slice(0, QUESTION_MAX - 1)}…` : s;
  return { text: cut || EMPTY_CELL, title: s || undefined, ...(href && row ? { href: href(row) } : {}) };
};
