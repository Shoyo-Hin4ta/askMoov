"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatCompact, formatDay, formatValue, humanize } from "@/lib/format";
import { CHART } from "./chart-theme";

type Axis = { field: string; label?: string };

/** Short series get markers (8px with a surface ring); long ones stay a clean line and rely on hover. */
const MARKER_MAX_POINTS = 12;
const MARKER = { r: 4, fill: "var(--series)", stroke: "var(--surface)", strokeWidth: 2 };
type Row = Record<string, unknown>;

/** Single-series line (time on x) or bar (categories on x). The model never sees this layer. */
export function XYChart({ kind, title, rows, x, y }: { kind: "line" | "bar"; title: string; rows: Row[]; x: Axis; y: Axis }) {
  const data = rows.map((r) => ({ ...r, [x.field]: formatDay(r[x.field]), [y.field]: Number(r[y.field]) }));
  const yLabel = y.label ?? humanize(y.field);
  const xLabel = x.label ?? humanize(x.field);
  // Recharts puts className on its wrapper and measures it, so the height follows the breakpoint: 192px on phones, 240px from sm.
  const common = { data, responsive: true, className: "h-48 sm:h-60", style: { width: "100%" }, margin: { top: 12, right: 8, bottom: 4, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={CHART.grid} />
      <XAxis dataKey={x.field} tick={CHART.tick} axisLine={{ stroke: CHART.axis }} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
      <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => formatCompact(v)} />
      <Tooltip {...CHART.tooltip} cursor={kind === "bar" ? { fill: "var(--surface-2)" } : { stroke: CHART.axis }} formatter={(v) => [formatValue(v), yLabel]} />
    </>
  );
  return (
    <Card>
      <CardHeader title={title} aside={`${rows.length} points`} />
      <CardBody className="px-2 sm:px-4">
        {kind === "line" ? (
          <LineChart {...common}>
            {axes}
            <Line type="monotone" dataKey={y.field} stroke={CHART.series} strokeWidth={2} dot={data.length <= MARKER_MAX_POINTS ? MARKER : false} activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        ) : (
          <BarChart {...common} barCategoryGap="30%">
            {axes}
            <Bar dataKey={y.field} fill={CHART.series} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        )}
        <div className="mt-1 flex justify-between text-[11px] text-ink-3">
          <span>{xLabel}</span>
          <span>{yLabel}</span>
        </div>
      </CardBody>
    </Card>
  );
}
