import type { ReactNode } from "react";

/** Label and value pairs in a two-column grid at text size. Server-safe. */
export function KvList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-2">{k}</dt>
          <dd className="wrap-anywhere text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
