import { z } from "zod";
import type { Shape } from "./metrics";

export const VIZ_TYPES = ["stat", "line", "bar", "calendar", "table"] as const;
export const VizType = z.enum(VIZ_TYPES);
export type VizType = z.infer<typeof VizType>;

const axis = () => z.object({ field: z.string(), label: z.string() });

/**
 * Fresh instances per schema: the SDK turns a Zod instance used twice into a $ref.
 * `step` is the id of the plan step the chart is drawn from. The presenter names it from the plan's answer_from list,
 * code checks the choice against that step's columns and records it, and the UI and the episode store read it.
 */
const vizFields = () => ({
  type: VizType,
  title: z.string(),
  x: axis().optional(),
  y: axis().optional(),
  series: z.array(z.string()).optional(),
  caveats: z.array(z.string()),
});

export const VizSpec = z.object({ ...vizFields(), step: z.string() });
export type VizSpec = z.infer<typeof VizSpec>;

/** The presenter's output schema for one run: viz.step is limited to that plan's answer_from ids (validated by the wrapper). */
export function presentationFor(answerFrom: readonly string[]) {
  if (answerFrom.length === 0) throw new Error("presentationFor: answer_from is empty");
  return z.object({ answer_md: z.string(), viz: z.object({ ...vizFields(), step: z.enum(answerFrom as [string, ...string[]]) }) });
}
export type Presentation = z.infer<ReturnType<typeof presentationFor>>;

/** The step the chart is drawn from: the presenter's recorded choice, else the positional fallback for runs recorded before viz.step existed. */
export function chartStepId(viz: { step?: string } | null | undefined, answerFrom: readonly string[], shapeOf: (id: string) => string | undefined): string | undefined {
  return viz?.step ?? answerStepId(answerFrom, shapeOf);
}

/**
 * Positional fallback only: the first answer_from step whose shape is not scalar, else the last. It cannot tell two
 * rows-shaped steps apart, which is why the presenter now names the step (chartStepId); kept for runs stored without one.
 */
export function answerStepId(answerFrom: readonly string[], shapeOf: (id: string) => string | undefined): string | undefined {
  return answerFrom.find((id) => { const s = shapeOf(id); return s !== undefined && s !== "scalar"; }) ?? answerFrom[answerFrom.length - 1];
}

/** Code picks the chart from the result shape before the model sees anything. The presenter may only override within the enum. */
export function vizTypeForShape(shape: Shape): VizType {
  switch (shape) {
    case "scalar": return "stat";
    case "series": return "line";
    case "categories": return "bar";
    case "entity_by_day": return "calendar";
    case "rows": return "table";
  }
}
