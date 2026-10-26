import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inferColumns, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { StatList } from "@/components/ui/stat-list";
import { TableCard } from "@/components/ui/table-card";
import { EMPTY_CELL, formatValue, humanize } from "@/lib/format";
import { opsTables, type Table } from "@/lib/ops-queries";

export const dynamic = "force-dynamic";

/** Observability: the design doc 9.2 queries as cards. Server component, no client state. One column up to lg, two from lg. */
export default async function OpsPage() {
  const tables = await opsTables();
  return (
    <main className="min-h-dvh bg-page text-ink">
      <PageHeader title="Operations" links={[{ href: "/", label: "Back to chat" }, { href: "/schema", label: "Schema" }, { href: "/ops/runs", label: "All runs", fromSm: true }, { href: "/ops/calls", label: "All model calls", fromSm: true }]} />
      <nav className="flex gap-4 px-4 pt-4 text-xs text-ink-2 sm:hidden" aria-label="Indexes">
        <Link href="/ops/runs" prefetch={false} className="hover:text-ink">All runs</Link>
        <Link href="/ops/calls" prefetch={false} className="hover:text-ink">All model calls</Link>
      </nav>
      {/* grid-cols-1 gives minmax(0, 1fr); the implicit auto column would let a wide table push the card past the viewport. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-6 lg:grid-cols-2">
        {tables.map((t) => <OpsCard key={t.title} table={t} />)}
      </div>
    </main>
  );
}

function OpsCard({ table }: { table: Table }) {
  const first = table.rows[0];
  const keys = first ? Object.keys(first) : [];
  if (!first) {
    return (
      <Card>
        <CardHeader title={table.title} />
        <CardBody className="text-xs text-ink-3">No data yet</CardBody>
      </Card>
    );
  }
  if (table.layout === "stats") {
    return (
      <Card>
        <CardHeader title={table.title} />
        <CardBody>
          <StatList items={keys.map((k) => ({ label: humanize(k), value: formatValue(first[k]) }))} />
        </CardBody>
      </Card>
    );
  }
  return <TableCard title={table.title} columns={linkRunIds(inferColumns(keys, table.rows))} rows={table.rows} className="text-xs" />;
}

const RUN_ID_COLUMNS = new Set(["id", "latest_run"]);

/** A run id cell shows its first eight characters, carries the full id in its title, and links to the run's trace. */
function linkRunIds(columns: Column[]): Column[] {
  return columns.map((c) => RUN_ID_COLUMNS.has(c.key)
    ? { ...c, label: c.key === "id" ? "Run" : "Latest run", align: "left", kind: "id", format: (v) => (v ? { text: String(v).slice(0, 8), title: String(v), href: `/ops/runs/${String(v)}` } : { text: EMPTY_CELL }) }
    : c);
}
