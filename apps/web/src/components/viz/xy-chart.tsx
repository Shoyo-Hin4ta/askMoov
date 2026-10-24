"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CHART } from "./chart-theme";

export type AxisFormat = (v: unknown) => string;
export type Series = { key: string; label: string; color: string };
type Row = Record<string, unknown>;
type Props = {
  kind: "line" | "bar";
  title: string;
  /** Wide rows: one per x, one value column per series key. */
  data: Row[];
  x: { field: string; label: string; format: AxisFormat };
  y: { label: string; format: AxisFormat; percent?: boolean };
  series: Series[];
};

/** Short series get markers (8px with a surface ring); long ones stay a clean line and rely on hover. */
const MARKER_MAX_POINTS = 12;

/**
 * One to many series as lines (time on x) or bars (categories on x). The renderer shapes the data and decides the
 * formats; this component knows nothing about plans or labels. A legend appears only when there is more than one series.
 */
export function XYChart({ kind, title, data, x, y, series }: Props) {
  const grouped = series.length > 1;
  const order = new Map(series.map((s, i) => [s.label, i]));
  const common = { data, responsive: true, className: "h-48 sm:h-60", style: { width: "100%" }, margin: { top: 12, right: 8, bottom: 4, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={CHART.grid} />
      <XAxis dataKey={x.field} tick={CHART.tick} axisLine={{ stroke: CHART.axis }} tickLine={false} interval="preserveStartEnd" minTickGap={24} tickFormatter={(v: unknown) => x.format(v)} />
      <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={y.percent ? 48 : 40} tickFormatter={(v: unknown) => y.format(v)} />
      <Tooltip
        {...CHART.tooltip}
        cursor={kind === "bar" ? { fill: "var(--surface-2)" } : { stroke: CHART.axis }}
        formatter={(v, name) => [y.format(v), String(name)]}
        labelFormatter={(l) => x.format(l)}
        itemSorter={(item) => order.get(String(item.name)) ?? 0}
      />
    </>
  );
  return (
    <Card>
      <CardHeader title={title} aside={`${data.length} point${data.length === 1 ? "" : "s"}`} />
      <CardBody className="px-2 sm:px-4">
        {grouped && (
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-ink-2" aria-label="Series">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                {s.label}
              </li>
            ))}
          </ul>
        )}
        {kind === "line" ? (
          <LineChart {...common}>
            {axes}
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.color} strokeWidth={2} dot={data.length <= MARKER_MAX_POINTS ? { r: 4, fill: s.color, stroke: CHART.surface, strokeWidth: 2 } : false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart {...common} barCategoryGap={grouped ? "20%" : "30%"} barGap={2}>
            {axes}
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={grouped ? [2, 2, 0, 0] : [4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
        <div className="mt-1 flex justify-between px-2 text-[11px] text-ink-3">
          <span>{x.label}</span>
          <span>{y.label}</span>
        </div>
      </CardBody>
    </Card>
  );
}
