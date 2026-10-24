import { formatValue, humanize, isNumeric } from "@/lib/format";
import { cn } from "./cn";

export type Column = { key: string; label: string; align: "left" | "right"; kind: "text" | "number" | "id" };
export type Row = Record<string, unknown>;

const ID_KEY = /(^|_)id$/;

/** Columns from result keys: numeric columns (by the first non-null value) are right-aligned with tabular figures; id columns stay plain text. */
export function inferColumns(keys: string[], rows: Row[]): Column[] {
  return keys.map((key) => {
    if (ID_KEY.test(key)) return { key, label: humanize(key), align: "left", kind: "id" };
    const sample = rows.find((r) => r[key] !== null && r[key] !== undefined)?.[key];
    const numeric = sample !== undefined && isNumeric(sample);
    return { key, label: humanize(key), align: numeric ? "right" : "left", kind: numeric ? "number" : "text" };
  });
}

function cellText(c: Column, v: unknown): string {
  if (c.kind === "id") return v === null || v === undefined ? "" : String(v);
  return formatValue(v);
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
                const text = cellText(c, r[c.key]);
                return (
                  <td key={c.key} className={cn("px-3 py-1.5 text-ink", c.align === "right" ? "text-right tabular-nums" : "text-left")}>
                    {/* max-width is ignored on table cells; the block span is what truncates. */}
                    <span className="block max-w-[12rem] truncate sm:max-w-md" title={text.length > 24 ? text : undefined}>{text}</span>
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
