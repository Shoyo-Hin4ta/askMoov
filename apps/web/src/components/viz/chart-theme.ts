import type { CSSProperties } from "react";

/** Recharts styling from the page tokens. Thin marks, solid hairline grid, muted axes; the series colour is the only chroma. Height is a class on the chart. */
export const CHART = {
  series: "var(--series)",
  surface: "var(--surface)",
  grid: "var(--line-2)",
  axis: "var(--line)",
  tick: { fontSize: 11, fill: "var(--ink-3)" },
  tooltip: {
    contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, color: "var(--ink)", padding: "6px 10px" } as CSSProperties,
    labelStyle: { color: "var(--ink-2)", marginBottom: 2 } as CSSProperties,
    itemStyle: { color: "var(--ink)", padding: 0 } as CSSProperties,
  },
} as const;
