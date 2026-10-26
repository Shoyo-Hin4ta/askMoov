import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

export type Option = { value: string; label: string };
export type Field = { name: string; label: string } & (
  | { kind: "select"; options: Option[]; anyLabel?: string | null }
  | { kind: "text"; placeholder?: string; wide?: boolean }
  | { kind: "date" }
  | { kind: "checkbox" }
);

const CONTROL = "h-9 w-full min-w-0 rounded-control border border-line bg-surface px-2 text-base text-ink sm:text-sm";

/**
 * A plain GET form: the browser builds the URL, the server re-renders. No client code, so a filtered view is a link.
 * No hidden cursor: changing a filter starts from the newest page. "Clear" is a link to the bare path.
 */
export function FilterForm({ action, fields, values }: { action: string; fields: Field[]; values: Record<string, string | boolean | undefined> }) {
  return (
    <Card>
      <CardBody className="pt-4">
        <form method="get" action={action} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {fields.map((f) => {
            if (f.kind === "checkbox") {
              return (
                <label key={f.name} className="inline-flex h-9 items-center gap-2 self-end text-xs text-ink-2">
                  <input type="checkbox" name={f.name} value="1" defaultChecked={values[f.name] === true} className="h-4 w-4 accent-ink" />
                  {f.label}
                </label>
              );
            }
            const value = typeof values[f.name] === "string" ? (values[f.name] as string) : "";
            return (
              <label key={f.name} className={cn("flex min-w-0 flex-col gap-1 text-xs text-ink-2", f.kind === "text" && f.wide && "col-span-2 sm:col-span-3 lg:col-span-6")}>
                {f.label}
                {f.kind === "select" ? (
                  <select name={f.name} defaultValue={value} className={CONTROL}>
                    {f.anyLabel !== null && <option value="">{f.anyLabel ?? "Any"}</option>}
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input type={f.kind === "date" ? "date" : "text"} name={f.name} defaultValue={value} placeholder={f.kind === "text" ? f.placeholder : undefined} className={CONTROL} />
                )}
              </label>
            );
          })}
          <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-3 lg:col-span-6">
            <Button type="submit" variant="primary" size="sm">Apply</Button>
            <Link href={action} className="text-xs text-ink-2 hover:text-ink">Clear</Link>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
