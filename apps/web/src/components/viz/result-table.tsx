"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable, inferColumns, type Row } from "@/components/ui/data-table";

const PREVIEW_ROWS = 50;

/** Result rows with a preview cap and a show-all toggle. */
export function ResultTable({ title, columns, rows }: { title: string; columns: string[]; rows: Row[] }) {
  const [all, setAll] = useState(false);
  const capped = rows.length > PREVIEW_ROWS;
  return (
    <Card>
      <CardHeader title={title} aside={`${rows.length} row${rows.length === 1 ? "" : "s"}`} />
      <DataTable columns={inferColumns(columns, rows)} rows={rows} label={title} maxRows={all ? undefined : PREVIEW_ROWS} />
      {capped && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-ink-2">
          <span>Showing {all ? rows.length : PREVIEW_ROWS} of {rows.length} rows</span>
          <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>{all ? `Show first ${PREVIEW_ROWS}` : "Show all"}</Button>
        </div>
      )}
    </Card>
  );
}
