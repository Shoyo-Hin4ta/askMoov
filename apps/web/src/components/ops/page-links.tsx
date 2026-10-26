import Link from "next/link";
import { hrefWith } from "@/lib/ops-filters";

/** The row count and the keyset controls under an index table. "Older" carries the next cursor; "Newest" drops it. */
export function PageLinks({ path, params, shown, next, hasCursor }: { path: string; params: Record<string, string | undefined>; shown: number; next: string | null; hasCursor: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-2">
      <span>{shown} row{shown === 1 ? "" : "s"} on this page{next ? ", more below" : ""}</span>
      <nav className="flex gap-4" aria-label="Pages of results">
        {hasCursor && <Link href={hrefWith(path, params)} prefetch={false} className="hover:text-ink">Newest</Link>}
        {next && <Link href={hrefWith(path, params, next)} prefetch={false} className="hover:text-ink">Older</Link>}
      </nav>
    </div>
  );
}
