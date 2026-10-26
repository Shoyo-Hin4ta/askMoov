import Link from "next/link";
import { EMPTY_CELL, formatValue, humanize, isNumeric } from "@/lib/format";
import { labelFor, type Labels } from "@/lib/labels";
import { cn } from "./cn";

/** href: the cell links there (rendered with next/link, no prefetch). The caller decides which cells link. */
export type Cell = { text: string; title?: string; href?: string };
export type Column = { key: string; label: string; align: "left" | "right"; kind: "text" | "number" | "id"; format?: (v: unknown, row: Row) => Cell };
export type Row = Record<string, unknown>;

const ID_KEY = /(^|_)id$/;

function idCell(labels: Labels, key: string, v: unknown): Cell {
  if (v === null || v === undefined || v === "") return { text: EMPTY_CELL };
  const label = labelFor(labels, key, v);
  return label ? { text: label, title: `${label} (${String(v)})` } : { text: String(v) };
}

/**
 * Columns from result keys. A key the labels map covers, or one ending in "id", is an id column: left-aligned, printed as
 * its name when known with "Name (id)" in the title. A column whose cells show names is headed by the entity ("Student",
 * "Origin room"), not "Student id". Numeric columns (by the first non-null value) are right-aligned.
 */
export function inferColumns(keys: string[], rows: Row[], labels: Labels = {}): Column[] {
  return keys.map((key) => {
    if (key in labels) return { key, label: humanize(key.replace(/_id$/, "")), align: "left", kind: "id", format: (v) => idCell(labels, key, v) };
    if (ID_KEY.test(key)) return { key, label: humanize(key), align: "left", kind: "id", format: (v) => idCell(labels, key, v) };
    const sample = rows.find((r) => r[key] !== null && r[key] !== undefined)?.[key];
    const numeric = sample !== undefined && isNumeric(sample);
    return { key, label: humanize(key), align: numeric ? "right" : "left", kind: numeric ? "number" : "text" };
  });
}

function cell(c: Column, v: unknown, row: Row): Cell {
  if (c.format) return c.format(v, row);
  if (v === null || v === undefined) return { text: EMPTY_CELL };
  const text = formatValue(v);
  return { text, title: text.length > 24 ? text : undefined };
}

type Props = { columns: Column[]; rows: Row[]; label: string; maxRows?: number; className?: string };

/** Stateless table. Server-safe: no hooks. Scrolls sideways inside its card; the scroller is a labelled, focusable region. */
export function DataTable({ columns, rows, label, maxRows, className }: Props) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <div className={cn("overflow-x-auto", className)} tabIndex={0} role="region" aria-label={label}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 text-xs font-medium text-ink-2", c.align === "right" ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-b border-line-2 last:border-0 hover:bg-surface-2">
              {columns.map((c) => {
                const { text, title, href } = cell(c, r[c.key], r);
                return (
                  <td key={c.key} className={cn("px-3 py-1.5 text-ink", c.align === "right" ? "text-right tabular-nums" : "text-left")}>
                    {/* max-width is ignored on table cells; the block span is what truncates. */}
                    <span className="block max-w-[12rem] truncate sm:max-w-md" title={title}>
                      {href ? <Link href={href} prefetch={false} className="underline decoration-line underline-offset-2 hover:decoration-ink">{text}</Link> : text}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={Math.max(columns.length, 1)} className="px-3 py-4 text-center text-xs text-ink-3">No rows</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
