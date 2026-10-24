"use client";
import type { Results, StepOut, VizOut } from "@/lib/client/api";
import { CalendarHeatmap } from "./calendar-heatmap";
import { ResultTable } from "./result-table";
import { StatTile } from "./stat-tile";
import { XYChart } from "./xy-chart";

type Row = Record<string, unknown>;

function pickField(preferred: string | undefined, cols: string[], fallback: (c: string) => boolean): string | undefined {
  if (preferred && cols.includes(preferred)) return preferred;
  return cols.find(fallback);
}

/** One row per day is a calendar. Several rows per day (grouped by student and day) read better as a table. */
function isCalendarShaped(rows: Row[], cols: string[]): boolean {
  if (!cols.includes("day")) return false;
  return new Set(rows.map((r) => String(r["day"]).slice(0, 10))).size === rows.length;
}

/** Renders the VizSpec code chose from the result shape, against the rows of the answer step. Falls back to a table whenever the rows do not fit the chart. */
export function VizRenderer({ viz, step, results }: { viz: VizOut; step: StepOut | undefined; results: Results }) {
  if (!viz || !step) return null;
  const result = results[step.id];
  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];
  const table = <ResultTable title={viz.title} columns={cols} rows={rows} />;

  if (viz.type === "stat") return <StatTile label={viz.title} value={step.value ?? rows[0]?.["value"]} note={step.value === null ? step.explanation : undefined} />;
  if (rows.length === 0) return table;

  switch (viz.type) {
    case "line":
    case "bar": {
      const x = pickField(viz.x?.field, cols, (c) => c !== "value");
      const y = pickField(viz.y?.field, cols, (c) => c === "value") ?? cols[cols.length - 1];
      if (!x || !y || x === y) return table;
      return <XYChart kind={viz.type} title={viz.title} rows={rows} x={{ field: x, label: viz.x?.label }} y={{ field: y, label: viz.y?.label }} />;
    }
    case "calendar":
      return isCalendarShaped(rows, cols) ? <CalendarHeatmap title={viz.title} rows={rows} /> : table;
    default:
      return table;
  }
}
