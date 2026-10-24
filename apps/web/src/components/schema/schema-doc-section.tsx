import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import type { ParsedSchemaDoc } from "@/lib/schema-doc-parse";
import { SectionHeading } from "./section-heading";

const COLUMNS: Column[] = [
  { key: "column", label: "Column", align: "left", kind: "text" },
  { key: "type", label: "Type", align: "left", kind: "text" },
  { key: "comment", label: "Comment", align: "left", kind: "text" },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the agent reads: the analytics views, the domain notes and the worked examples, as the planner's document lays them out. */
export function SchemaDocSection({ doc, version, raw }: { doc: ParsedSchemaDoc; version: string; raw: string }) {
  return (
    <>
      <SectionHeading title="What the agent reads" aside={`schema version ${version}`}>
        Every query reads these views and nothing else. The comments, notes and examples come from the migrations; nothing here is hand-written.
      </SectionHeading>
      {doc.views.map((v) => (
        <Card key={v.name}>
          <CardHeader title={v.name} aside={plural(v.columns.length, "column")} />
          {v.comment && <CardBody className="pb-2 text-xs text-ink-2">{v.comment}</CardBody>}
          <DataTable columns={COLUMNS} rows={v.columns} label={`${v.name} columns`} className="text-xs" />
          {v.other.length > 0 && (
            <CardBody className="pt-2 text-xs text-ink-2">
              <ul className="list-disc space-y-1 pl-4">{v.other.map((o) => <li key={o}>{o}</li>)}</ul>
            </CardBody>
          )}
        </Card>
      ))}
      <Card>
        <CardHeader title="Domain notes" aside={plural(doc.notes.length, "note")} />
        <CardBody>
          <dl className="space-y-2 text-sm">
            {doc.notes.map((n) => (
              <div key={n.topic}>
                <dt className="font-medium text-ink">{n.topic}</dt>
                <dd className="text-ink-2">{n.text}</dd>
              </div>
            ))}
            {doc.notes.length === 0 && <div className="text-xs text-ink-3">None stored</div>}
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Worked examples" aside={plural(doc.examples.length, "example")} />
        <CardBody>
          <ul className="space-y-3 text-sm">
            {doc.examples.map((e) => (
              <li key={`${e.view}:${e.question}`}>
                <div className="text-ink">{e.question}</div>
                <div className="text-xs text-ink-3">{e.view}</div>
                <pre className="mt-1 overflow-x-auto rounded-control bg-surface-2 p-2 font-mono text-[11px] text-ink">{e.spec}</pre>
              </li>
            ))}
            {doc.examples.length === 0 && <li className="text-xs text-ink-3">None stored</li>}
          </ul>
        </CardBody>
      </Card>
      <div className="lg:col-span-2">
        <Disclosure summary="What the planner sees, verbatim">
          {doc.unparsed.length > 0 && <p className="mb-2 text-xs text-ink-2">{plural(doc.unparsed.length, "line")} did not fit the sections above and are included below.</p>}
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink">{raw}</pre>
        </Disclosure>
      </div>
    </>
  );
}
