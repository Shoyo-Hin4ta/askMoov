import {
  MAX_STEPS, MAX_LIMIT, metricDef,
  type Plan, type Persona, type SpecStep, type Step,
} from "@ask-moov/shared";
import { PlanValidationError } from "./errors";
import { referencedSteps } from "./refs";
import { FORMULAS } from "./tools/calc";
import { compile } from "./compiler";

/**
 * Code checks on a schema-valid plan, before anything executes (design doc 4.5a and 4.3).
 * Throws PlanValidationError with a message the planner can act on in its one corrective call.
 */
export type KnownEntity = { type: string; id: number | string };

export function validatePlan(plan: Plan, persona: Persona, knownEntities: KnownEntity[]): void {
  if (plan.steps.length < 1) throw new PlanValidationError("plan has no steps");
  if (plan.steps.length > MAX_STEPS) throw new PlanValidationError(`plan has ${plan.steps.length} steps; maximum is ${MAX_STEPS}`);

  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(step.id)) throw new PlanValidationError(`step id "${step.id}" must be a short identifier like a, b, c`);
    if (ids.has(step.id)) throw new PlanValidationError(`duplicate step id "${step.id}"`);
    ids.add(step.id);
  }

  const seen: string[] = [];
  for (const step of plan.steps) {
    for (const ref of referencedSteps(stepBody(step))) {
      if (ref === step.id) throw new PlanValidationError(`step ${step.id} references itself`);
      if (!seen.includes(ref)) throw new PlanValidationError(`step ${step.id} references $${ref}, which is not an earlier step; earlier steps: ${seen.join(", ") || "none"}`);
    }
    seen.push(step.id);
  }

  for (const id of plan.answer_from) if (!ids.has(id)) throw new PlanValidationError(`answer_from names unknown step "${id}"; steps: ${[...ids].join(", ")}`);
  if (plan.answer_from.length === 0) throw new PlanValidationError("answer_from is empty");

  for (const step of plan.steps) {
    if (step.kind === "spec") checkSpecStep(step, persona, knownEntities);
    if (step.kind === "calc" && step.formula !== "expr" && !(step.formula in FORMULAS)) {
      throw new PlanValidationError(`step ${step.id}: unknown calc formula "${step.formula}"; known: ${Object.keys(FORMULAS).join(", ")}, expr`);
    }
    if (step.kind === "sql" && !step.sql.trim()) throw new PlanValidationError(`step ${step.id}: empty sql`);
  }
}

function checkSpecStep(step: SpecStep, persona: Persona, known: KnownEntity[]): void {
  const spec = step.spec;
  metricDef(spec.metric);
  if (spec.limit !== undefined && spec.limit > MAX_LIMIT) throw new PlanValidationError(`step ${step.id}: limit ${spec.limit} exceeds ${MAX_LIMIT}`);

  const e = spec.entity;
  if (e && !isRefLike(e.id)) {
    const ids = Array.isArray(e.id) ? e.id : [e.id];
    for (const id of ids) {
      const ok = e.type === "school" || known.some((k) => k.type === e.type && String(k.id) === String(id));
      if (!ok) throw new PlanValidationError(`step ${step.id}: entity ${e.type} ${id} did not come from lookup_entity in this run or a pin in this thread`);
    }
  }
  // Compile with refs stubbed so metric/group_by/filter pairing errors surface before execution.
  const stub = isRefLike(spec.entity?.id) ? { ...spec, entity: { type: spec.entity!.type, id: 0 } } : spec;
  compile(stub, persona);
}

function isRefLike(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("$");
}

function stepBody(step: Step): unknown {
  switch (step.kind) {
    case "spec": return step.spec;
    case "calc": return step.args;
    case "sql": return null;
  }
}
