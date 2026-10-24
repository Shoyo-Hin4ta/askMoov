import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-surface", className)} {...rest} />;
}

export function CardHeader({ title, aside, className }: { title: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 px-4 pb-2 pt-3", className)}>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      {aside !== undefined && aside !== null && <div className="shrink-0 text-xs text-ink-3">{aside}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...rest} />;
}
