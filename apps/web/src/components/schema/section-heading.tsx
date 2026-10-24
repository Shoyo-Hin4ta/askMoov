import type { ReactNode } from "react";

/** A section title spanning the page grid, with an optional note under it. */
export function SectionHeading({ title, aside, children }: { title: string; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pt-2 lg:col-span-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {aside !== undefined && <span className="shrink-0 text-xs text-ink-3">{aside}</span>}
      </div>
      {children && <p className="mt-1 text-xs text-ink-2">{children}</p>}
    </div>
  );
}
