import type { ReactNode } from "react";
import { Card, CardHeader } from "./card";
import { DataTable, type Column, type Row } from "./data-table";

/** A titled card holding one table that scrolls inside it. Server-safe. */
export function TableCard({ title, columns, rows, aside, className }: { title: string; columns: Column[]; rows: Row[]; aside?: ReactNode; className?: string }) {
  return (
    <Card>
      <CardHeader title={title} aside={aside ?? `${rows.length} row${rows.length === 1 ? "" : "s"}`} />
      <DataTable columns={columns} rows={rows} label={title} className={className} />
    </Card>
  );
}
