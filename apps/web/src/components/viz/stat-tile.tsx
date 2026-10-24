import { Card } from "@/components/ui/card";
import { formatCompact, formatValue } from "@/lib/format";

/**
 * One headline figure. Proportional figures on purpose: tabular digits look loose at this size.
 * note: what a calc said when it has no number (a change from a zero baseline); shown in the figure slot instead of "No value".
 */
export function StatTile({ label, value, note }: { label: string; value: unknown; note?: string }) {
  const text = typeof value === "number" ? formatCompact(value) : formatValue(value);
  return (
    <Card className="px-4 py-4 sm:px-5">
      <div className="text-sm text-ink-2">{label}</div>
      {text || !note
        ? <div className="mt-1 wrap-anywhere text-4xl font-semibold leading-none tracking-tight text-ink sm:text-5xl">{text || "No value"}</div>
        : <div className="mt-2 text-base font-medium leading-snug text-ink">{note}</div>}
    </Card>
  );
}
