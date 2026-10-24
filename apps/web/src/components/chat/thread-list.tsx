import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { Thread } from "@/lib/client/api";
import { formatRelative } from "@/lib/format";

type Props = { threads: Thread[]; loading: boolean; activeId: string; onOpen: (t: Thread) => void; onNew: () => void };

/** The persona's past conversations, newest first. Reopening one continues it. */
export function ThreadList({ threads, loading, activeId, onOpen, onNew }: Props) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-4">
        <h2 className="text-xs font-medium text-ink-2">Threads</h2>
        <Button variant="ghost" size="sm" onClick={onNew}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New
        </Button>
      </div>
      <ul className="flex-1 overflow-y-auto overscroll-y-contain px-2 pb-2">
        {threads.map((t) => {
          const active = t.thread_id === activeId;
          return (
            <li key={t.thread_id}>
              <button type="button" onClick={() => onOpen(t)} title={t.first_question} aria-current={active ? "true" : undefined} className={cn("mb-0.5 block w-full rounded-control px-2 py-2 text-left transition-colors", active ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                <span className={cn("line-clamp-2 text-sm leading-snug", active ? "font-medium text-ink" : "text-ink-2")}>{t.first_question}</span>
                <span className="mt-0.5 block text-[11px] text-ink-3">
                  {formatRelative(t.last_asked_at)}
                  {t.runs > 1 ? `, ${t.runs} questions` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {threads.length === 0 && loading && <li className="px-2 py-3 text-xs text-ink-3" aria-busy="true">Loading threads</li>}
        {threads.length === 0 && !loading && <li className="px-2 py-3 text-xs text-ink-3">No threads yet. Ask something to start one.</li>}
      </ul>
    </section>
  );
}
