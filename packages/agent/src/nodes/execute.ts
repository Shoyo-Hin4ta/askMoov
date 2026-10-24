import { MAX_SQL_REGENERATIONS, RUN_TIME_BUDGET_MS, type Step } from "@ask-moov/shared";
import { compile } from "../compiler";
import type { AgentDeps, Row } from "../deps";
import { RunBudgetError, SqlRejectedError } from "../errors";
import { referencedSteps, resolveRefsDeep, type StepValues } from "../refs";
import type { State, StateUpdate, StepResult } from "../state";
import { assertValidSql } from "../validator";
import { calc } from "../tools/calc";
import { caveat, errorText, isFatal } from "./shared";

/** One plan step per invocation, so every step gets its own checkpoint. Rows go to the result store, never into state. */
export async function executeNode(state: State, deps: AgentDeps): Promise<StateUpdate> {
  const plan = state.plan_output;
  if (!plan || plan.kind !== "plan") return { error: "execute called without a plan", last_node: "execute" };
  const step = plan.steps[state.step_index];
  if (!step) return { error: `no step at index ${state.step_index}`, last_node: "execute" };

  const elapsed = Date.now() - state.started_at;
  if (elapsed > RUN_TIME_BUDGET_MS) return { error: errorText(new RunBudgetError(elapsed, RUN_TIME_BUDGET_MS)), last_node: "execute" };

  try {
    const inputs = await priorResults(state, deps, step);
    const result = await runStep(step, state, deps, inputs);
    // one caveat per kind for the whole run; the first step that triggers it owns it
    const caveats = (result.caveatKinds ?? []).filter((k) => !state.caveats.some((c) => c.kind === k)).map((k) => caveat(k, step.id));
    return {
      steps: { ...state.steps, [step.id]: result.stepResult },
      step_index: state.step_index + 1,
      caveats: [...state.caveats, ...caveats],
      last_node: "execute",
    };
  } catch (e) {
    if (e instanceof SqlRejectedError && step.kind === "sql" && state.retries.sql < MAX_SQL_REGENERATIONS) {
      return {
        steps: { ...state.steps, [step.id]: { status: "error", kind: "sql", sql: e.sql, error: e.message } },
        retries: { ...state.retries, sql: state.retries.sql + 1 },
        replan_context: `Step ${step.id} (kind sql) was rejected: ${e.message}\nSQL:\n${e.sql}\nRewrite that step. Keep the other steps unless they depend on it.`,
        step_index: 0,
        caveats: [],
        last_node: "execute",
      };
    }
    if (isFatal(e)) return { error: errorText(e), steps: { ...state.steps, [step.id]: { status: "error", kind: step.kind, error: errorText(e) } }, last_node: "execute" };
    throw e;
  }
}

async function priorResults(state: State, deps: AgentDeps, step: Step): Promise<Record<string, StepValues>> {
  const body = step.kind === "spec" ? step.spec : step.kind === "calc" ? step.args : null;
  const needed = referencedSteps(body);
  const out: Record<string, StepValues> = {};
  for (const [id, r] of Object.entries(state.steps)) {
    if (r.status !== "ok") continue;
    const v: StepValues = { value: r.value, row_count: r.row_count };
    if (needed.includes(id) && (r.row_count ?? 0) > 0) v.rows = (await deps.results.get(state.run_id, id)).rows;
    else if (needed.includes(id)) v.rows = [];
    out[id] = v;
  }
  return out;
}

async function runStep(step: Step, state: State, deps: AgentDeps, inputs: Record<string, StepValues>): Promise<{ stepResult: StepResult; caveatKinds?: string[] }> {
  switch (step.kind) {
    case "calc": {
      const args: Record<string, number | number[]> = {};
      for (const a of step.args) args[a.name] = resolveRefsDeep(a.value, inputs) as number | number[];
      if (step.formula === "expr") (args as Record<string, unknown>)["expr"] = step.args.find((a) => a.name === "expr")?.value;
      // An upstream step with no value (a calc over a zero baseline, an aggregate over zero rows) is a data outcome the planner
      // could not foresee: this step has no value either, with the reason. Plan mistakes still throw inside calc().
      const missing = step.args
        .filter((a) => { const v: unknown = args[a.name]; return v === null || (Array.isArray(v) && v.some((x) => x === null)); })
        .map((a) => `${a.name} (${String(a.value)})`);
      if (missing.length) return { stepResult: { status: "ok", kind: "calc", value: null, explanation: `no value: ${missing.join(", ")} has no value`, shape: "scalar" } };
      const r = calc(step.formula, args);
      return { stepResult: { status: "ok", kind: "calc", value: r.value, explanation: r.explanation, shape: "scalar" } };
    }
    case "spec": {
      const spec = resolveRefsDeep(step.spec, inputs);
      const compiled = compile(spec, state.persona);
      const sql = await assertValidSql(compiled.sql, { injectLimit: false });
      const { rows, columns } = await runSql(deps, state, sql, compiled.params, "compiled");
      await deps.results.put(state.run_id, step.id, columns, rows);
      const value = compiled.shape === "scalar" ? rows[0]?.["value"] ?? null : undefined;
      return {
        stepResult: { status: "ok", kind: "spec", sql, params: compiled.params, shape: compiled.shape, row_count: rows.length, columns, ...(value !== undefined ? { value } : {}) },
        caveatKinds: compiled.caveats,
      };
    }
    case "sql": {
      const sql = await assertValidSql(step.sql, { injectLimit: true });
      const { rows, columns } = await runSql(deps, state, sql, [], "generated");
      await deps.results.put(state.run_id, step.id, columns, rows);
      const value = rows.length === 1 && columns.length === 1 ? rows[0]![columns[0]!] : undefined;
      return { stepResult: { status: "ok", kind: "sql", sql, params: [], shape: "rows", row_count: rows.length, columns, ...(value !== undefined ? { value } : {}) } };
    }
  }
}

async function runSql(deps: AgentDeps, state: State, sql: string, params: unknown[], origin: "compiled" | "generated"): Promise<{ rows: Row[]; columns: string[] }> {
  try {
    if (!deps.skipExplain) await deps.scopedQuery(state.persona, `EXPLAIN ${sql}`, params);
    return await deps.scopedQuery(state.persona, sql, params);
  } catch (e) {
    if (e instanceof SqlRejectedError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (origin === "generated") throw new SqlRejectedError(`Postgres rejected the SQL: ${msg}`, sql);
    throw new SqlRejectedError(`compiled SQL failed, which is a bug: ${msg}`, sql);
  }
}
