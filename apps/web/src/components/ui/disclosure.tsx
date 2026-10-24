import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

/** Native details/summary with a rotating chevron. Works without JavaScript. */
export function Disclosure({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group rounded-control border border-line", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="border-t border-line px-3 py-3">{children}</div>
    </details>
  );
}
