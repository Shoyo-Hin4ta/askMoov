import type { Labels, PlanOut, StepOut } from "@/lib/client/api";
import { formatPercent, formatValue, humanize } from "@/lib/format";
import { labelFor } from "@/lib/labels";
import { isRateStep } from "@/lib/rates";

export type CalcInput = { label: string; text: string };

/** A calc argument that reads another step's scalar: "$a.value". */
const STEP_VALUE = /^\$([A-Za-z][A-Za-z0-9_]*)\.value$/;

/**
 * The values a headline calculation was computed from, labelled: a comparison shows both schools' rates, a change shows
 * before and after, a target shows attended and scheduled. An input is named by the entity its step asks about when every
 * input has a named entity and the names differ (two schools); otherwise by the argument's role (before, after, attended).
 * Each value keeps its own step's format (a rate step reads as a percentage). Fewer than two inputs: nothing to show.
 */
export function calcInputs(plan: PlanOut, steps: StepOut[], labels: Labels, stepId: string): CalcInput[] {
  if (!plan || plan.kind !== "plan") return [];
  const calc = plan.steps.find((s) => s.id === stepId);
  if (!calc || calc.kind !== "calc" || !calc.args) return [];
  const inputs = calc.args.flatMap((a) => {
    const ref = typeof a.value === "string" ? STEP_VALUE.exec(a.value)?.[1] : undefined;
    const source = ref ? plan.steps.find((s) => s.id === ref) : undefined;
    const value = ref ? steps.find((s) => s.id === ref)?.value : undefined;
    if (!source || typeof value !== "number" || !Number.isFinite(value)) return [];
    const entity = source.kind === "spec" ? source.spec.entity : undefined;
    const name = entity && !Array.isArray(entity.id) ? labelFor(labels, entity.type, entity.id) : undefined;
    return [{ role: humanize(a.name), name, text: isRateStep(plan, source.id) ? formatPercent(value) : formatValue(value) }];
  });
  if (inputs.length < 2) return [];
  const names = inputs.map((i) => i.name);
  const byEntity = names.every((n) => n !== undefined) && new Set(names).size === names.length;
  return inputs.map((i) => ({ label: byEntity ? i.name! : i.role, text: i.text }));
}
