import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { appliesTo, POLICY_LEGEND } from "@/lib/policies";
import type { PolicyRow } from "@/lib/schema-queries";
import { SectionHeading } from "./section-heading";

/** Who can see what: the row-level security policies grouped by table, each with what its qual means and the qual itself. */
export function PolicySection({ policies }: { policies: PolicyRow[] }) {
  const byTable = new Map<string, PolicyRow[]>();
  for (const p of policies) {
    const key = `${p.schemaname}.${p.tablename}`;
    byTable.set(key, [...(byTable.get(key) ?? []), p]);
  }
  return (
    <>
      <SectionHeading title="Who can see what" aside={`${policies.length} polic${policies.length === 1 ? "y" : "ies"}`}>{POLICY_LEGEND}</SectionHeading>
      {[...byTable.entries()].map(([table, rows]) => (
        <Card key={table}>
          <CardHeader title={table} aside={`${rows.length} polic${rows.length === 1 ? "y" : "ies"}`} />
          <CardBody>
            <ul className="space-y-3">
              {rows.map((p) => (
                <li key={p.policyname} className="space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="font-mono text-xs text-ink">{p.policyname}</span>
                    <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">{p.cmd}</span>
                    <span className="text-ink">{appliesTo(p.qual)}</span>
                  </div>
                  <pre className="wrap-anywhere whitespace-pre-wrap rounded-control bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-ink-2">{p.qual ?? "(no qual)"}</pre>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
    </>
  );
}
