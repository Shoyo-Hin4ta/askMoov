/** The asked question, with the asker's initials. Transcript style, left aligned, so wide answers sit under it. */
export function QuestionBlock({ text, initials }: { text: string; initials: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-on-ink" aria-hidden>{initials}</span>
      <p className="min-w-0 wrap-anywhere text-[15px] font-medium leading-relaxed text-ink">{text}</p>
    </div>
  );
}
