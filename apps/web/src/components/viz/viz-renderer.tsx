"use client";
import type { Labels, PlanOut, Results, StepOut, VizOut } from "@/lib/client/api";
import { formatDay, formatPercent, formatValue, humanize, isIsoDate } from "@/lib/format";
import { displayId } from "@/lib/labels";
import { calcInputs } from "@/lib/calc-inputs";
import { isRateStep } from "@/lib/rates";
import { CalendarHeatmap } from "./calendar-heatmap";
import { CHART } from "./chart-theme";
import { pivotGrouped, seriesColumn } from "./pivot";
import { ResultTable } from "./result-table";
import { StatTile } from "./stat-tile";
import { XYChart, type AxisFormat } from "./xy-chart";

type Row = Record<string, unknown>;
type Props = { viz: VizOut; step: StepOut | undefined; steps: StepOut[]; results: Results; labels: Labels; plan: PlanOut };

function pickField(preferred: string | undefined, cols: string[], fallback: (c: string) => boolean): string | undefined {
  if (preferred && cols.includes(preferred)) return preferred;
  return cols.find(fallback);
}

/** One row per day is a calendar. Several rows per day (grouped by student and day) read better as a table. */
function isCalendarShaped(rows: Row[], cols: string[]): boolean {
  if (!cols.includes("day")) return false;
  return new Set(rows.map((r) => String(r["day"]).slice(0, 10))).size === rows.length;
}

/** Axis text for a dimension: the entity's name when the column carries ids, a short date for dates, the value otherwise. */
function dimensionFormat(labels: Labels, field: string): AxisFormat {
  if (field in labels) return (v) => displayId(labels, field, v);
  return (v) => (isIsoDate(v) ? formatDay(v) : v === null || v === undefined ? "" : String(v));
}

/**
 * Renders the VizSpec code chose from the result shape, against the rows of the answer step. Owns the data shaping:
 * labels for id columns, percentages for rate steps, the pivot for grouped results. Falls back to a table whenever the
 * rows do not fit the chart.
 */
export function VizRenderer({ viz, step, steps, results, labels, plan }: Props) {
  if (!viz || !step) return null;
  const result = results[step.id];
  const rows = result?.rows ?? [];
  const cols = result?.columns ?? [];
  const percent = isRateStep(plan, step.id);
  const valueFormat: AxisFormat = (v) => (percent && typeof v === "number" ? formatPercent(v) : formatValue(v));
  const table = <ResultTable title={viz.title} columns={cols} rows={rows} labels={labels} />;

  if (viz.type === "stat") {
    return <StatTile label={viz.title} value={step.value ?? rows[0]?.["value"]} note={step.value === null ? step.explanation : undefined} format={percent ? formatPercent : undefined} inputs={calcInputs(plan, steps, labels, step.id)} />;
  }
  if (rows.length === 0) return table;

  switch (viz.type) {
    case "line":
    case "bar": {
      const y = pickField(viz.y?.field, cols, (c) => c === "value") ?? cols[cols.length - 1];
      if (!y) return table;
      const yAxis = { label: viz.y?.label ?? humanize(y), format: valueFormat, percent };
      const dims = cols.filter((c) => c !== y);
      if (viz.type === "bar" && step.shape === "grouped" && dims.length === 2) {
        const s = seriesColumn([dims[0]!, dims[1]!], rows);
        const xField = dims.find((d) => d !== s)!;
        const pivot = pivotGrouped(rows, { x: xField, series: s, value: y });
        if (pivot.series.filter((ps) => !ps.empty).length > CHART.categorical.length) return table;
        const series = pivot.series.map((ps, i) => ({ key: ps.key, label: ps.empty ? ps.label : displayId(labels, s, ps.label), color: ps.empty ? CHART.none : CHART.categorical[i]! }));
        return <XYChart kind="bar" title={viz.title} data={pivot.data} x={{ field: xField, label: viz.x?.label ?? humanize(xField), format: dimensionFormat(labels, xField) }} y={yAxis} series={series} />;
      }
      const x = pickField(viz.x?.field, cols, (c) => c !== y);
      if (!x || x === y) return table;
      const data = rows.map((r) => ({ ...r, [y]: Number(r[y]) }));
      return <XYChart kind={viz.type} title={viz.title} data={data} x={{ field: x, label: viz.x?.label ?? humanize(x), format: dimensionFormat(labels, x) }} y={yAxis} series={[{ key: y, label: yAxis.label, color: CHART.series }]} />;
    }
    case "calendar":
      return isCalendarShaped(rows, cols) ? <CalendarHeatmap title={viz.title} rows={rows} /> : table;
    default:
      return table;
  }
}
