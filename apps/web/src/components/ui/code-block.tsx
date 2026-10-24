import { cn } from "./cn";

/** Preformatted text that scrolls inside its box and breaks long tokens, so it never widens the page. Keyboard-reachable like the table scroller. */
export function CodeBlock({ children, label, className }: { children: string; label: string; className?: string }) {
  return (
    <pre
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn("max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-control bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink", className)}
    >
      {children}
    </pre>
  );
}
