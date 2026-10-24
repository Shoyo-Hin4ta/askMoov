import { ChevronRight } from "lucide-react";
import type { RunView } from "@/lib/client/api";
import { cn } from "@/components/ui/cn";
import { formatDuration } from "@/lib/format";
import { totalMs, trailEntries } from "./trail";

const STATE: Record<string, string> = {
  done: "text-ink",
  active: "bg-series-soft text-ink",
  pending: "text-ink-3",
  failed: "text-danger",
};

/** The run's path through the fixed graph: what ran, how long each node took, what is still to come. */
export function RunTrail({ view }: { view: RunView | null }) {
  const entries = trailEntries(view);
  const total = totalMs(view);
  return (
    <div className="flex items-center gap-2 text-xs">
      <ol className="flex min-w-0 flex-wrap items-center gap-y-1">
        {entries.map((e, i) => (
          <li key={e.key} className="flex items-center">
            {i > 0 && <ChevronRight className="mx-0.5 h-3 w-3 text-ink-3/60" aria-hidden />}
            <span className={cn("inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5", STATE[e.state])}>
              {e.state === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-series" aria-hidden />}
              {e.label}
              {e.duration_ms !== undefined && <span className="tabular-nums text-ink-3">{formatDuration(e.duration_ms)}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="ml-auto flex shrink-0 items-center gap-3 text-ink-3">
        {view && view.attempt > 1 && <span>attempt {view.attempt}</span>}
        {total > 0 && <span className="tabular-nums">{formatDuration(total)}</span>}
      </div>
    </div>
  );
}
