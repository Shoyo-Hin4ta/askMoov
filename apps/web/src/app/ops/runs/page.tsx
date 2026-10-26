import { PERSONA_KEYS } from "@ask-moov/shared";
import { FilterForm, type Field } from "@/components/ops/filter-form";
import { col, duration, number, question, runLink, sha, text, usd, utc, yesNo } from "@/components/ops/index-columns";
import { PageLinks } from "@/components/ops/page-links";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { parseRunFilters, runCursor, runFilterParams, RUN_PATHS, RUN_STATUSES, SOURCES, type SearchParams } from "@/lib/ops-filters";
import { listRuns } from "@/lib/ops-index-queries";

export const dynamic = "force-dynamic";

const PATH = "/ops/runs";
const RETENTION = "Full prompt and response text is kept for 7 days; the numbers are kept after that.";

const FIELDS: Field[] = [
  { name: "status", label: "Status", kind: "select", options: RUN_STATUSES.map((v) => ({ value: v, label: v })) },
  { name: "role", label: "Role", kind: "select", options: PERSONA_KEYS.map((v) => ({ value: v, label: v })) },
  { name: "source", label: "Source", kind: "select", anyLabel: null, options: SOURCES.map((v) => ({ value: v, label: v })) },
  { name: "path", label: "Path", kind: "select", options: RUN_PATHS.map((v) => ({ value: v, label: v })) },
  { name: "from", label: "From (UTC)", kind: "date" },
  { name: "to", label: "To (UTC)", kind: "date" },
  { name: "sha", label: "Git sha", kind: "text", placeholder: "prefix" },
  { name: "error", label: "Has error", kind: "checkbox" },
  { name: "q", label: "Question contains", kind: "text", placeholder: "text", wide: true },
];

const COLUMNS = [
  col("id", "Run", runLink),
  col("created_at", "Asked (UTC)", utc),
  col("question", "Question", question((row) => `/ops/runs/${String(row["id"])}`)),
  col("persona", "Persona", text),
  col("source", "Source", text),
  col("status", "Status", text),
  col("path", "Path", text),
  col("attempt", "Attempt", number, "right"),
  col("latency_ms", "Latency", duration, "right"),
  col("total_tokens", "Tokens", number, "right"),
  col("cost_usd", "Cost", usd, "right"),
  col("rounds", "Rounds", number, "right"),
  col("prompt_kept", "Prompt kept", yesNo),
  col("git_sha", "Git sha", sha),
];

/** Every run, newest first, 50 per page, filters in the URL. Server component; the form is a plain GET. */
export default async function RunsIndexPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = parseRunFilters(sp);
  const cursor = runCursor(sp);
  const page = await listRuns(filters, cursor);
  const rows = page.rows.map((r) => ({ ...r, persona: r.role ? (r.name ? `${r.role}, ${r.name}` : r.role) : null }));
  const params = runFilterParams(filters);
  return (
    <main className="min-h-dvh bg-page text-ink">
      <PageHeader title="All runs" links={[{ href: "/", label: "Back to chat" }, { href: "/ops", label: "Operations", fromSm: true }, { href: "/ops/calls", label: "All model calls" }, { href: "/schema", label: "Schema", fromSm: true }]} />
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <p className="text-xs text-ink-2">{RETENTION}</p>
        <FilterForm action={PATH} fields={FIELDS} values={{ ...filters, error: filters.error }} />
        <TableCard
          title="Runs"
          aside={filters.source === "chat" ? "chat runs, newest first" : filters.source === "eval" ? "eval runs, newest first" : "every run, newest first"}
          columns={COLUMNS}
          rows={rows}
          className="text-xs"
          footer={<PageLinks path={PATH} params={params} shown={rows.length} next={page.next} hasCursor={cursor !== undefined} />}
        />
      </div>
    </main>
  );
}
