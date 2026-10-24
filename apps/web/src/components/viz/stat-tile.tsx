import { Card } from "@/components/ui/card";
import { formatCompact, formatValue } from "@/lib/format";

type Props = {
  label: string;
  value: unknown;
  /** What a calc said when it has no number (a change from a zero baseline); shown in the figure slot instead of "No value". */
  note?: string;
  /** How to print a finite number (a percentage for rate steps). Strings and nulls keep their own paths. */
  format?: (n: number) => string;
};

/** One headline figure. Proportional figures on purpose: tabular digits look loose at this size. */
export function StatTile({ label, value, note, format = formatCompact }: Props) {
  const text = typeof value === "number" && Number.isFinite(value) ? format(value) : formatValue(value);
  return (
    <Card className="px-4 py-4 sm:px-5">
      <div className="text-sm text-ink-2">{label}</div>
      {text || !note
        ? <div className="mt-1 wrap-anywhere text-4xl font-semibold leading-none tracking-tight text-ink sm:text-5xl">{text || "No value"}</div>
        : <div className="mt-2 text-base font-medium leading-snug text-ink">{note}</div>}
    </Card>
  );
}
