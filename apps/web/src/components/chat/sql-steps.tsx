import { Disclosure } from "@/components/ui/disclosure";
import type { StepOut } from "@/lib/client/api";
import { formatValue } from "@/lib/format";

const KIND: Record<StepOut["kind"], string> = { spec: "compiled", calc: "calc", sql: "generated SQL" };

/** The SQL behind every answer, one block per step, with row counts and scalar values. */
export function SqlSteps({ steps }: { steps: StepOut[] }) {
  return (
    <Disclosure summary={`SQL, ${steps.length} step${steps.length === 1 ? "" : "s"}`}>
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-ink">{s.id}</span>
              <span>{KIND[s.kind]}</span>
              {s.row_count !== undefined && <span>{s.row_count} row{s.row_count === 1 ? "" : "s"}</span>}
              {s.value !== undefined && s.value !== null && <span>value {formatValue(s.value)}</span>}
              {s.error && <span className="text-danger">{s.error}</span>}
            </div>
            {s.explanation && <p className="text-xs text-ink-2">{s.explanation}</p>}
            {s.sql && <pre className="overflow-x-auto rounded-control bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink">{s.sql}</pre>}
            {s.params && s.params.length > 0 && <div className="wrap-anywhere font-mono text-[11px] text-ink-3">params {JSON.stringify(s.params)}</div>}
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
