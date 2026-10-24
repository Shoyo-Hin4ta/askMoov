import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, inferColumns } from "@/components/ui/data-table";
import { StatList } from "@/components/ui/stat-list";
import { formatValue, humanize } from "@/lib/format";
import { opsTables, type Table } from "@/lib/ops-queries";

export const dynamic = "force-dynamic";

/** Observability: the design doc 9.2 queries as cards. Server component, no client state. One column up to lg, two from lg. */
export default async function OpsPage() {
  const tables = await opsTables();
  return (
    <main className="min-h-dvh bg-page text-ink">
      <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <h1 className="font-semibold">Ask MOOV</h1>
          <span className="text-sm text-ink-2">Operations</span>
        </div>
        <Link href="/" className="text-xs text-ink-2 hover:text-ink">Back to chat</Link>
      </header>
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
  return (
    <Card>
      <CardHeader title={table.title} aside={`${table.rows.length} row${table.rows.length === 1 ? "" : "s"}`} />
      <DataTable columns={inferColumns(keys, table.rows)} rows={table.rows} label={table.title} className="text-xs" />
    </Card>
  );
}
