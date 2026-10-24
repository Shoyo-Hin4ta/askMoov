import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KvList } from "@/components/ui/kv-list";
import { EMPTY_CELL, formatDuration, formatValue } from "@/lib/format";
import { formatTimestamp, formatUsd, type TraceRun } from "@/lib/trace";

function scopeOf(p: TraceRun["persona"]): string {
  if (!p) return EMPTY_CELL;
  if (p.scope_summary) return p.scope_summary;
  return [p.role, p.user_id !== undefined ? `user ${p.user_id}` : null, p.school_id !== undefined ? `school ${p.school_id}` : null].filter(Boolean).join(", ") || EMPTY_CELL;
}

/** The run row: what was asked, by whom, and how it went. */
export function RunHeader({ run }: { run: TraceRun }) {
  const mono = (s: string, title?: string) => <span className="font-mono" title={title}>{s}</span>;
  const items: [string, React.ReactNode][] = [
    ["Asked as", scopeOf(run.persona)],
    ["Status", run.uncertain ? `${run.status}, marked uncertain` : run.status],
    ["Path", run.path ?? EMPTY_CELL],
    ["Attempt", String(run.attempt)],
    ["Latency", run.latency_ms === null ? EMPTY_CELL : formatDuration(run.latency_ms)],
    ["Tokens", run.total_tokens === null ? EMPTY_CELL : formatValue(run.total_tokens)],
    ["Cost", formatUsd(run.cost_usd) || EMPTY_CELL],
    ["Git sha", run.git_sha ? mono(run.git_sha.slice(0, 8), run.git_sha) : EMPTY_CELL],
    ["Run id", mono(run.id)],
    ["Thread", mono(run.thread_id)],
    ["Created", formatTimestamp(run.created_at)],
    ["Finished", run.finished_at ? formatTimestamp(run.finished_at) : EMPTY_CELL],
  ];
  if (run.error) items.push(["Error", <span key="error" className="text-danger">{run.error}</span>]);
  return (
    <Card>
      <CardHeader title={run.question} aside={run.status} />
      <CardBody>
        <KvList items={items} />
      </CardBody>
    </Card>
  );
}
