import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/** A pill-shaped choice: example questions and clarification options. */
export function Chip({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs leading-snug text-ink transition-colors hover:border-ink-3 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
}
