import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatCompact, formatDay, formatLongDay, formatValue } from "@/lib/format";

/** Sequential blue ramp (one hue, light to dark) from the data-viz reference palette. Fixed hex: the cells carry their own ink. */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const INK_ON_LIGHT = "#14213d";
const INK_ON_DARK = "#ffffff";
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Square cells on phones (about 43px at 390px wide), fixed height from sm. */
const CELL = "aspect-square sm:aspect-auto sm:h-11";

type Cell = { iso: string; value: number | null; inRange: boolean; label: string };
type Row = Record<string, unknown>;

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Every day from the Monday before the first row to the Sunday after the last. Month shown on the 1st and on the first cell in range. */
function buildCells(byDay: Map<string, number>): Cell[] {
  const days = [...byDay.keys()].sort();
  const start = utc(days[0]!);
  const end = utc(days[days.length - 1]!);
  const first = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY_MS);
  const cells: Cell[] = [];
  let seenInRange = false;
  for (let d = first; d <= end || cells.length % 7 !== 0; d = new Date(d.getTime() + DAY_MS)) {
    const iso = d.toISOString().slice(0, 10);
    const inRange = d >= start && d <= end;
    const showMonth = inRange && (!seenInRange || d.getUTCDate() === 1);
    if (inRange) seenInRange = true;
    cells.push({ iso, value: byDay.get(iso) ?? null, inRange, label: showMonth ? formatDay(iso) : String(d.getUTCDate()) });
  }
  return cells;
}

function stepFor(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(RAMP.length - 1, Math.round((value / max) * (RAMP.length - 1)));
}

export function CalendarHeatmap({ title, rows, dayField = "day", valueField = "value" }: { title: string; rows: Row[]; dayField?: string; valueField?: string }) {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const key = String(r[dayField] ?? "").slice(0, 10);
    if (key) byDay.set(key, Number(r[valueField]) || 0);
  }
  if (byDay.size === 0) return null;
  const cells = buildCells(byDay);
  const max = Math.max(...byDay.values());

  return (
    <Card>
      <CardHeader title={title} aside={`${byDay.size} days`} />
      <CardBody>
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-[10px] text-ink-3 sm:text-[11px]">{w}</div>
          ))}
          {cells.map((c) => <DayCell key={c.iso} cell={c} max={max} />)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
          <span>0</span>
          <div className="flex gap-0.5">
            {RAMP.map((hex) => <span key={hex} className="h-2.5 w-4 rounded-sm" style={{ background: hex }} />)}
          </div>
          <span>{formatValue(max)}</span>
          <span className="basis-full sm:ml-auto sm:basis-auto">Dashed cells have no data</span>
        </div>
      </CardBody>
    </Card>
  );
}

function DayCell({ cell, max }: { cell: Cell; max: number }) {
  if (!cell.inRange) return <div aria-hidden className={CELL} />;
  const text = `${formatLongDay(cell.iso)}: ${cell.value === null ? "no data" : formatValue(cell.value)}`;
  const base = cn(CELL, "flex flex-col overflow-hidden rounded-control px-1 py-0.5 sm:px-1.5 sm:py-1");
  if (cell.value === null) {
    return (
      <div role="img" aria-label={text} title={text} className={cn(base, "border border-dashed border-line text-ink-3")}>
        <span className="truncate text-[10px] sm:text-[11px]">{cell.label}</span>
      </div>
    );
  }
  const step = stepFor(cell.value, max);
  return (
    <div role="img" aria-label={text} title={text} style={{ background: RAMP[step], color: step >= 3 ? INK_ON_DARK : INK_ON_LIGHT }} className={cn(base, "justify-between")}>
      <span className="truncate text-[10px] opacity-80 sm:text-[11px]">{cell.label}</span>
      <span className="self-end text-xs font-medium leading-none tabular-nums sm:text-sm">{formatCompact(cell.value)}</span>
    </div>
  );
}
