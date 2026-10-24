import { Caveats } from "@/components/chat/caveats";
import { Markdown } from "@/components/chat/markdown";
import { SqlSteps } from "@/components/chat/sql-steps";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ResultTable } from "@/components/viz/result-table";
import type { Results, RunOutput } from "@/lib/client/api";

/** What the run produced: the answer, its caveats, the SQL per step, and the stored rows per step. No chart here. */
export function OutputSection({ output, results }: { output: RunOutput | null; results: Results }) {
  const stepIds = Object.keys(results);
  return (
    <Card>
      <CardHeader title="Output" aside={output?.viz ? `chart ${output.viz.type}` : undefined} />
      <CardBody className="space-y-4">
        {output ? <Markdown text={output.answer_md} /> : <p className="text-xs text-ink-3">No output stored: the run did not succeed, or its output expired.</p>}
        {output && output.caveats.length > 0 && <Caveats caveats={output.caveats} />}
        {output && output.steps.length > 0 && <SqlSteps steps={output.steps} />}
        {stepIds.map((id) => <ResultTable key={id} title={`Step ${id} rows`} columns={results[id]!.columns} rows={results[id]!.rows} labels={output?.labels ?? {}} />)}
      </CardBody>
    </Card>
  );
}
