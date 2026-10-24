/** A grid of small labelled figures, for single-row metric queries. Server-safe. The caller supplies the padding (CardBody). */
export function StatList({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-ink-2">{i.label}</dt>
          <dd className="mt-0.5 text-xl font-semibold text-ink">{i.value || "none"}</dd>
        </div>
      ))}
    </dl>
  );
}
