import { notFound } from "next/navigation";
import { getRunTrace } from "@ask-moov/db";
import { RunTrail } from "@/components/chat/run-trail";
import { AutoRefresh } from "@/components/trace/auto-refresh";
import { OutputSection } from "@/components/trace/output-section";
import { Rounds } from "@/components/trace/rounds";
import { RunHeader } from "@/components/trace/run-header";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, inferColumns } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { formatDuration } from "@/lib/format";
import { isRunId } from "@/lib/run-id";
import { formatTimestamp, trailView, type RunTrace } from "@/lib/trace";

export const dynamic = "force-dynamic";

/** One run top to bottom: header, the chat's trail, every model round and tool call, then the output. Server component over getRunTrace. */
const CALL_ID = /^\d{1,18}$/;

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const roundParam = (await searchParams)["round"];
  const openRound = typeof roundParam === "string" && CALL_ID.test(roundParam) ? roundParam : undefined;
  if (!isRunId(id)) notFound();
  const trace = (await getRunTrace(id)) as RunTrace | null;
  if (!trace) notFound();
  const inFlight = trace.run.status === "queued" || trace.run.status === "running";
  const steps = trace.trail.map((t) => ({
    node: t.node, attempt: t.attempt, started: formatTimestamp(t.started_at), duration: formatDuration(t.duration_ms), error: t.error,
    input_summary: JSON.stringify(t.input_summary), output_summary: JSON.stringify(t.output_summary),
  }));

  return (
    <main className="min-h-dvh bg-page text-ink">
      <PageHeader title="Run" links={[{ href: "/", label: "Back to chat" }, { href: "/ops", label: "Operations" }, { href: "/ops/runs", label: "All runs" }, { href: "/schema", label: "Schema", fromSm: true }]} />
      <div className="mx-auto min-w-0 max-w-6xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <AutoRefresh active={inFlight} />
        <RunHeader run={trace.run} />
        <Card>
          <CardBody className="pt-3">
            <RunTrail view={trailView(trace.run, trace.trail)} />
          </CardBody>
        </Card>
        <Disclosure summary={`Step summaries, ${steps.length} step${steps.length === 1 ? "" : "s"}`}>
          <DataTable columns={inferColumns(["node", "attempt", "started", "duration", "error", "input_summary", "output_summary"], steps)} rows={steps} label="Step summaries" className="text-xs" />
        </Disclosure>
        <Rounds calls={trace.llm_calls} tools={trace.tool_calls} openRound={openRound} />
        <OutputSection output={trace.output} results={trace.results} />
      </div>
    </main>
  );
}
