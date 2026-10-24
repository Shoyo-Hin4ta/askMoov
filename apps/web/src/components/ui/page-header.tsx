import Link from "next/link";

/** The chrome of a secondary page: wordmark, page name, links to the other pages. Server-safe. */
export function PageHeader({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="shrink-0 font-semibold text-ink">Ask MOOV</h1>
        <span className="truncate text-sm text-ink-2">{title}</span>
      </div>
      <nav className="flex shrink-0 items-center gap-4 text-xs text-ink-2" aria-label="Pages">
        {links.map((l) => <Link key={l.href} href={l.href} className="hover:text-ink">{l.label}</Link>)}
      </nav>
    </header>
  );
}
