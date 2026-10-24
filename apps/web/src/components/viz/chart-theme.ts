import type { CSSProperties } from "react";

/** Recharts styling from the page tokens. Thin marks, solid hairline grid, muted axes; only data carries colour. Height is a class on the chart. */
export const CHART = {
  /** Single-series colour (the first categorical slot). */
  series: "var(--series)",
  /** Categorical slots in fixed order (dataviz reference palette); a series beyond the eighth falls back to a table. */
  categorical: ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"],
  /** The empty series ("No wing"): neutral grey, never a hue. */
  none: "var(--cat-none)",
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
