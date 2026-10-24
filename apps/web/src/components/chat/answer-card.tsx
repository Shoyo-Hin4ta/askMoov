"use client";
import { chartStepId } from "@ask-moov/shared";
import type { ClarificationOption, RunView } from "@/lib/client/api";
import { VizRenderer } from "@/components/viz/viz-renderer";
import { Caveats } from "./caveats";
import { ClarificationChips } from "./clarification-chips";
import { Feedback } from "./feedback";
import { Markdown } from "./markdown";
import { RunCard } from "./run-card";
import { SqlSteps } from "./sql-steps";
import { TraceLink } from "./trace-link";

/** A finished answer: prose, chips, the chart, caveats, SQL per step, thumbs (design doc 13.4 and 13.5). */
export function AnswerCard({ view, onChip }: { view: RunView & { output: NonNullable<RunView["output"]> }; onChip: (option: ClarificationOption, question: string) => void }) {
  const out = view.output;
  const plan = out.plan;
  // the step the chart is drawn from: the presenter's recorded choice (viz.step); runs stored before it existed fall back to the positional rule
  const stepId = plan?.kind === "plan" ? chartStepId(out.viz, plan.answer_from, (id) => out.steps.find((s) => s.id === id)?.shape) : undefined;
  const answerStep = out.steps.find((s) => s.id === stepId);

  return (
    <RunCard view={view}>
      <div className="space-y-4">
        <Markdown text={out.answer_md} />
        {plan?.kind === "out_of_scope" && plan.options && plan.options.length > 0 && <ClarificationChips options={plan.options} onPick={(o) => onChip(o, view.question)} />}
        {out.viz && <VizRenderer viz={out.viz} step={answerStep} results={out.results} labels={out.labels ?? {}} plan={plan} />}
        {out.caveats.length > 0 && <Caveats caveats={out.caveats} />}
        {out.steps.length > 0 && <SqlSteps steps={out.steps} />}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {plan?.kind === "plan" ? <Feedback runId={view.id} initial={view.vote ?? null} /> : <span />}
          <TraceLink runId={view.id} />
        </div>
      </div>
    </RunCard>
  );
}
