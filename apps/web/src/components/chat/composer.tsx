import { ArrowUp, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; helpOpen: boolean; onToggleHelp: () => void };

/** The question input. readOnly, not disabled, while a run is in flight so focus and the phone keyboard survive. */
export function Composer({ value, onChange, onSubmit, busy, helpOpen, onToggleHelp }: Props) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      aria-busy={busy}
      className="border-t border-line bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-card border border-line bg-page pl-4 pr-2 focus-within:border-series">
          <input
            aria-label="Question"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Ask about taps, passes, attendance or devices"
            readOnly={busy}
            enterKeyHint="send"
            autoComplete="off"
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 read-only:opacity-60 md:text-sm"
          />
          <Button type="submit" variant="primary" size="icon" aria-label="Ask" disabled={busy || !value.trim()}>
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Button variant="ghost" onClick={onToggleHelp} aria-pressed={helpOpen} aria-label="What can I ask?" className="px-2.5 sm:px-3.5">
          <CircleHelp className="h-4 w-4 sm:hidden" aria-hidden />
          <span className="hidden sm:inline">What can I ask?</span>
        </Button>
      </div>
    </form>
  );
}
