import type { PlanOut } from "@/lib/client/api";

/** Metrics whose value is a fraction of 1 (attendance_rate is avg(1.0/0.0), device_uptime is avg(online_ratio)). */
const RATE_METRICS = new Set(["attendance_rate", "device_uptime"]);
/** Calc formulas that return a fraction (rate = num/den, pct_of = part/whole, change = (after - before)/before). */
const RATE_FORMULAS = new Set(["rate", "pct_of", "change"]);

/** Whether a plan step's value is a fraction to show as a percentage. Resolved from the plan, never from result rows. */
export function isRateStep(plan: PlanOut, stepId: string | undefined): boolean {
  if (!plan || plan.kind !== "plan" || !stepId) return false;
  const step = plan.steps?.find((s) => s.id === stepId);
  if (!step) return false;
  if (step.kind === "spec") return RATE_METRICS.has(step.spec.metric);
  if (step.kind === "calc") return RATE_FORMULAS.has(step.formula);
  return false;
}
