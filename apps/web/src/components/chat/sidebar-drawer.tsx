"use client";
import { useEffect, useRef, type ReactNode } from "react";

const DESKTOP = "(min-width: 48rem)";

type Props = { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode };

/**
 * Left slide-in panel on a native dialog. showModal() supplies the focus trap, Escape, the top layer and an inert page,
 * so there is no scroll-lock or focus code here. Closes on backdrop click and when the viewport grows past md.
 */
export function SidebarDrawer({ open, onClose, labelledBy, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia(DESKTOP);
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) onClose(); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-y-0 left-0 m-0 h-full max-h-none w-[min(20rem,85vw)] max-w-none -translate-x-full overscroll-contain border-r border-line bg-surface p-0 text-ink transition-transform duration-200 backdrop:bg-ink/40 open:translate-x-0 starting:open:-translate-x-full md:hidden"
    >
      {children}
    </dialog>
  );
}
