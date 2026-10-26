import { FilterForm, type Field } from "@/components/ops/filter-form";
import { col, duration, number, question, runLink, text, utc } from "@/components/ops/index-columns";
import { PageLinks } from "@/components/ops/page-links";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { callCursor, callFilterParams, parseCallFilters, type SearchParams } from "@/lib/ops-filters";
import { callOptions, listCalls } from "@/lib/ops-index-queries";

export const dynamic = "force-dynamic";

const PATH = "/ops/calls";
const RETENTION = "Full prompt and response text is kept for 7 days; the numbers are kept after that.";

const COLUMNS = [
  col("created_at", "Time (UTC)", utc),
  col("node", "Node", text),
  col("model", "Model", text),
  col("prompt_tokens", "Prompt", number, "right"),
  col("completion_tokens", "Completion", number, "right"),
  col("cache_read_tokens", "Cache read", number, "right"),
  col("latency_ms", "Latency", duration, "right"),
  col("stop_reason", "Stop reason", text),
  col("error", "Error", text),
  col("question", "Question", question((row) => `/ops/runs/${String(row["run_id"])}?round=${String(row["id"])}#round-${String(row["id"])}`)),
  col("run_id", "Run", runLink),
];

/** Every model call, newest first, 50 per page, filters in the URL. A question cell opens the run page on that round. */
export default async function CallsIndexPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseCallFilters(sp);
  const cursor = callCursor(sp);
  const [page, options] = await Promise.all([listCalls(filters, cursor), callOptions()]);
  const fields: Field[] = [
    { name: "node", label: "Node", kind: "select", options: options.nodes.map((v) => ({ value: v, label: v })) },
    { name: "model", label: "Model", kind: "select", options: options.models.map((v) => ({ value: v, label: v })) },
    { name: "from", label: "From (UTC)", kind: "date" },
    { name: "to", label: "To (UTC)", kind: "date" },
    { name: "sha", label: "Git sha", kind: "text", placeholder: "prefix" },
    { name: "error", label: "Has error", kind: "checkbox" },
    { name: "run", label: "Run id", kind: "text", placeholder: "uuid", wide: true },
  ];
  const params = callFilterParams(filters);
  return (
    <main className="min-h-dvh bg-page text-ink">
      <PageHeader title="All model calls" links={[{ href: "/", label: "Back to chat" }, { href: "/ops", label: "Operations", fromSm: true }, { href: "/ops/runs", label: "All runs" }, { href: "/schema", label: "Schema", fromSm: true }]} />
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <p className="text-xs text-ink-2">{RETENTION}</p>
        <FilterForm action={PATH} fields={fields} values={{ ...filters, error: filters.error }} />
        <TableCard
          title="Model calls"
          aside="newest first"
          columns={COLUMNS}
          rows={page.rows}
          className="text-xs"
          footer={<PageLinks path={PATH} params={params} shown={page.rows.length} next={page.next} hasCursor={cursor !== undefined} />}
        />
      </div>
    </main>
  );
}
