import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Column } from "@/components/ui/data-table";
import { StatList } from "@/components/ui/stat-list";
import { TableCard } from "@/components/ui/table-card";
import type { ColumnPrivilege, RoleSetting } from "@/lib/schema-queries";
import { SectionHeading } from "./section-heading";

const COLUMN_COLUMNS: Column[] = [
  { key: "table", label: "Table", align: "left", kind: "text" },
  { key: "column", label: "Column", align: "left", kind: "text" },
  { key: "readable", label: "Query role may read", align: "left", kind: "text", format: (v) => ({ text: v ? "yes" : "no" }) },
];
const ROLE_COLUMNS: Column[] = [
  { key: "role", label: "Role", align: "left", kind: "text" },
  { key: "setting", label: "Setting", align: "left", kind: "text" },
];

/** Column-level limits and role settings: which public columns the query role may read (exceptions first), and the two roles' settings. */
export function PrivilegeSection({ columns, roles }: { columns: ColumnPrivilege[]; roles: RoleSetting[] }) {
  const unreadable = columns.filter((c) => !c.readable);
  return (
    <>
      <SectionHeading title="Column-level limits and role settings">
        The query role reads the data tables through the analytics views and may not read every column. The app role runs the agent and has no access to the data at all.
      </SectionHeading>
      <Card>
        <CardHeader title="Public table columns" />
        <CardBody>
          <StatList items={[
            { label: "Columns", value: String(columns.length) },
            { label: "Readable by the query role", value: String(columns.length - unreadable.length) },
            { label: "Not readable", value: String(unreadable.length) },
          ]} />
          {unreadable.length > 0 && (
            <p className="mt-3 text-xs text-ink-2">Not readable: {unreadable.map((c) => `${c.table}.${c.column}`).join(", ")}.</p>
          )}
        </CardBody>
      </Card>
      <TableCard title="Role settings" columns={ROLE_COLUMNS} rows={roles} className="text-xs" />
      <div className="lg:col-span-2">
        <TableCard title="Every public column, exceptions first" columns={COLUMN_COLUMNS} rows={columns} className="text-xs" />
      </div>
    </>
  );
}
