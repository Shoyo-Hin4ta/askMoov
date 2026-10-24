import Link from "next/link";

/** The run's trace page: every model round, tool call and row behind an answer. */
export function TraceLink({ runId }: { runId: string }) {
  return <Link href={`/ops/runs/${runId}`} prefetch={false} className="text-xs text-ink-3 hover:text-ink">Trace</Link>;
}
