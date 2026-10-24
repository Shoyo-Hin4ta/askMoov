"use client";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export type Tab = { id: string; label: string; content: ReactNode };

/** A tab list with roving focus: arrows move and select, Home and End jump, one panel is rendered at a time. No dependency. */
export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const tabId = (i: number) => `${base}-tab-${i}`;
  const panelId = (i: number) => `${base}-panel-${i}`;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = tabs.length;
    let next = active;
    if (e.key === "ArrowRight") next = (active + 1) % n;
    else if (e.key === "ArrowLeft") next = (active - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    setActive(next);
    document.getElementById(tabId(next))?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabId(i)}
            aria-selected={i === active}
            aria-controls={panelId(i)}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-xs font-medium", i === active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId(active)} aria-labelledby={tabId(active)} tabIndex={0} className="pt-3">
        {tabs[active]?.content}
      </div>
    </div>
  );
}
