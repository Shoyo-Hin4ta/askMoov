import { TriangleAlert } from "lucide-react";
import type { Caveat } from "@/lib/client/api";

/** What was inferred rather than measured. First-class, not a footnote. */
export function Caveats({ caveats }: { caveats: Caveat[] }) {
  return (
    <div className="flex gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2.5 text-xs">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium text-ink">Caveats</div>
        <ul className="mt-1 space-y-1 text-ink-2">
          {caveats.map((c) => <li key={`${c.kind}:${c.text}`}>{c.text}</li>)}
        </ul>
      </div>
    </div>
  );
}
