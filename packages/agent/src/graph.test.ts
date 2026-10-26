import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "./graph";
import { newRunInput, type State } from "./state";
import { Llm, type LlmClient } from "./llm";
import type { AgentDeps, Row } from "./deps";
import { fakeClient } from "./fakes";
import { PERSONAS } from "./fixtures";

/* ---------- fakes (the scripted model client lives in fakes.ts, shared with the database tests) ---------- */

function fakeDeps(client: LlmClient, over: Partial<AgentDeps> = {}): AgentDeps & { trace_steps: string[]; store: Map<string, Row[]> } {
  const trace_steps: string[] = [];
  const store = new Map<string, Row[]>();
  return {
    llm: new Llm(client, { runTokenCap: 100_000 }),
    schemaDoc: { text: "views...", version: "v1" },
    frozenNow: "2026-10-13T10:40:00Z",
    async scopedQuery(_p, sql) {
      if (sql.includes("v_school_days")) return { rows: ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-13"].map((d) => ({ d })), columns: ["d"] };
      if (sql.includes("v_entities")) return { rows: [{ id: 1203, label: "Bart Simpson", detail: "9th", confidence: 0.6 }, { id: 1204, label: "Bart Reyes", detail: "11th", confidence: 0.4 }], columns: [] };
      if (sql.includes("v_my_history")) return { rows: [], columns: [] };
      return { rows: [{ value: 12 }], columns: ["value"] };
    },
    results: {
      async put(run, step, _c, rows) { store.set(`${run}/${step}`, rows); },
      async get(run, step) { return { columns: ["value"], rows: store.get(`${run}/${step}`) ?? [] }; },
    },
    episodes: null,
    trace: { async toolCall() {}, async step(r) { trace_steps.push(r.node); } },
    attempt: 1,
    chaos: null,
    pins: [],
    skipExplain: true,
    trace_steps,
    store,
    ...over,
  };
}

const persona = PERSONAS[1]!; // admin
const sketch = { json: { metrics: ["pass_count"], entity_types: ["student"], shape: "scalar" } };
const planWith = (steps: unknown[], answer_from = ["a"]) => ({ json: { kind: "plan", steps, answer_from, expected_shape: "scalar" } });
const specStep = { id: "a", kind: "spec", spec: { metric: "pass_count", entity: { type: "student", id: 1203 }, time_range: { start: "2026-10-01", end: "2026-10-13" } } };
const lookupBart = { name: "lookup_entity", input: { type: "student", text: "Bart", filters: { grade: 9, period: null, section_id: null, teacher_id: null } } };
const pass = { json: { pass: true, reason: "ok" } };
const failCritique = { json: { pass: false, reason: "wrong period", fixes: "use period 4" } };
/** viz.step must name a step in the plan's answer_from, so a plan that answers from another step needs presentFor(thatStep). */
const presentFor = (step: string) => ({ json: { answer_md: "Bart took 12 passes.", viz: { type: "stat", title: "Passes", caveats: [], step } } });
const presentation = presentFor("a");

function input(run = "run-1", question = "How many bathroom passes did Bart take this month?") {
  return newRunInput({ run_id: run, thread_id: "t-1", persona, question, schema_version: "v1", git_sha: "abc" });
}

/* ---------- tests ---------- */

describe("graph topology", () => {
  it("happy path: sketch -> plan -> execute -> critique -> present", async () => {
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith([specStep])], critique: [pass], present: [presentation] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input())) as State;
    expect(deps.trace_steps).toEqual(["sketch", "plan", "execute", "critique", "present"]);
    expect(out.answer).toBe("Bart took 12 passes.");
    expect(out.viz).toMatchObject({ type: "stat", step: "a" });
    expect(out.path).toBe("compiled");
    expect(out.steps["a"]).toMatchObject({ status: "ok", value: 12, shape: "scalar" });
    expect(out.resolved.entities[0]).toMatchObject({ id: 1203, label: "Bart Simpson" });
    expect(calls).toEqual({ sketch: 1, plan: 2, critique: 1, present: 1 });
  });

  describe("the presenter names the chart step", () => {
    // a (scalar, columns value) and b (grouped, columns wing, value) are both listed in answer_from; the chart must come from one of them
    const grouped = { id: "b", kind: "spec", spec: { ...specStep.spec, group_by: ["wing"] } };
    const twoSteps = planWith([specStep, grouped], ["a", "b"]);
    const bar = (step: string, x = "wing") => ({ json: { answer_md: "East leads.", viz: { type: "bar", title: "Passes by wing", caveats: [], step, x: { field: x, label: "Wing" }, y: { field: "value", label: "Passes" } } } });
    const depsWithColumns = (client: LlmClient) => fakeDeps(client, {
      async scopedQuery(_p, sql) {
        if (sql.includes("v_school_days")) return { rows: ["2026-10-01", "2026-10-13"].map((d) => ({ d })), columns: ["d"] };
        if (sql.includes("v_entities")) return { rows: [{ id: 1203, label: "Bart Simpson", detail: "9th", confidence: 0.97 }], columns: [] };
        if (sql.includes("v_my_history")) return { rows: [], columns: [] };
        if (sql.includes("GROUP BY")) return { rows: [{ wing: "East", value: 7 }], columns: ["wing", "value"] };
        return { rows: [{ value: 12 }], columns: ["value"] };
      },
    });

    it("records the chosen step; a field outside that step's columns gets exactly one corrective call", async () => {
      const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, twoSteps], critique: [pass], present: [bar("a"), bar("b")] });
      const out = (await buildGraph(depsWithColumns(client)).invoke(input("run-viz-1"))) as State;
      expect(out.error).toBeNull();
      expect(calls["present"]).toBe(2);
      expect(out.viz).toMatchObject({ type: "bar", step: "b", x: { field: "wing" } });
    });

    it("a step id outside answer_from is a parse error that gets the same single correction", async () => {
      const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, twoSteps], critique: [pass], present: [bar("zzz"), bar("b")] });
      const out = (await buildGraph(depsWithColumns(client)).invoke(input("run-viz-2"))) as State;
      expect(out.error).toBeNull();
      expect(calls["present"]).toBe(2);
      expect(out.viz?.step).toBe("b");
    });

    it("a second mismatch fails the run with a named error instead of shipping a mislabeled chart", async () => {
      const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, twoSteps], critique: [pass], present: [bar("a"), bar("a")] });
      const out = (await buildGraph(depsWithColumns(client)).invoke(input("run-viz-3"))) as State;
      expect(calls["present"]).toBe(2);
      expect(out.error).toContain("VizValidationError: wing is not a column of step a; its columns are value");
      expect(out.viz).toBeNull();
    });
  });

  it("out_of_scope skips execute and critique", async () => {
    const oos = { json: { kind: "out_of_scope", reason: "not_in_data", message: "No grades here.", suggestion: "I can show attendance." } };
    const { client } = fakeClient({ sketch: [sketch], plan: [oos], present: [presentation] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input("run-2", "What are Bart's grades?"))) as State;
    expect(deps.trace_steps).toEqual(["sketch", "plan", "present"]);
    expect(out.answer).toContain("No grades here.");
    expect(out.viz).toBeNull();
  });

  it("critic failure replans at most twice, then presents as uncertain", async () => {
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith([specStep])], critique: [failCritique], present: [presentation] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input("run-3"))) as State;
    expect(calls["plan"]).toBe(4); // 1 tool round + 3 plans
    expect(calls["critique"]).toBe(3);
    expect(out.uncertain).toBe(true);
    expect(out.retries.plan).toBe(2);
    expect(deps.trace_steps.filter((n) => n === "execute")).toHaveLength(3);
  });

  it("an ambiguous lookup becomes needs_clarification even if the planner emitted a plan", async () => {
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith([specStep])], present: [presentation] });
    const deps = fakeDeps(client, {
      async scopedQuery(_p, sql) {
        if (sql.includes("v_entities")) return { rows: [{ id: 1203, label: "Bart Simpson", detail: "9th", confidence: 0.6 }, { id: 1204, label: "Bart Reyes", detail: "11th", confidence: 0.58 }], columns: [] };
        if (sql.includes("v_my_history")) return { rows: [], columns: [] };
        return { rows: [], columns: [] };
      },
    });
    const out = (await buildGraph(deps).invoke(input("run-4"))) as State;
    expect(out.plan_output).toMatchObject({ kind: "out_of_scope", reason: "needs_clarification" });
    const options = (out.plan_output as { options: { label: string; entity?: { id: unknown; label?: string; detail?: string } }[] }).options;
    expect(options).toHaveLength(2);
    expect(options[0]!.entity).toMatchObject({ id: 1203, label: "Bart Simpson", detail: "9th" });
    expect(deps.trace_steps).not.toContain("execute");
  });

  it("the model's own clarification chips get their entity from the lookup candidates; an invented id is dropped", async () => {
    const asked = { json: { kind: "out_of_scope", reason: "needs_clarification", message: "Which Bart?", options: [
      { label: "Bart Simpson, 9th", entity: { type: "student", id: 1203 } },
      { label: "Bart Reyes, 11th", entity: { type: "student", id: 1204 } },
      { label: "Someone else", entity: { type: "student", id: 9999 } },
    ] } };
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, asked], present: [presentation] });
    const deps = fakeDeps(client, {
      async scopedQuery(_p, sql) {
        if (sql.includes("v_entities")) return { rows: [{ id: 1203, label: "Bart Simpson", detail: "9th", confidence: 0.6 }, { id: 1204, label: "Bart Reyes", detail: "11th", confidence: 0.58 }], columns: [] };
        if (sql.includes("v_my_history")) return { rows: [], columns: [] };
        return { rows: [], columns: [] };
      },
    });
    const out = (await buildGraph(deps).invoke(input("run-chips"))) as State;
    const options = (out.plan_output as { options: { label: string; entity?: { id: unknown; label?: string; detail?: string } }[] }).options;
    expect(options.map((o) => o.entity)).toEqual([
      { type: "student", id: 1203, label: "Bart Simpson", detail: "9th" },
      { type: "student", id: 1204, label: "Bart Reyes", detail: "11th" },
      undefined,
    ]);
  });

  it("a schema-valid but invalid plan gets exactly one corrective call", async () => {
    const bad = planWith([specStep, { id: "b", kind: "calc", formula: "rate", args: [{ name: "num", value: "$zzz.value" }, { name: "den", value: 2 }] }], ["b"]);
    const good = planWith([specStep, { id: "b", kind: "calc", formula: "rate", args: [{ name: "num", value: "$a.value" }, { name: "den", value: 2 }] }], ["b"]);
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, bad, good], critique: [pass], present: [presentFor("b")] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input("run-5"))) as State;
    expect(out.error).toBeNull();
    expect(calls["plan"]).toBe(3);
    expect(out.retries.corrective).toBe(1);
    expect(out.steps["b"]).toMatchObject({ status: "ok", value: 6 });
    expect(out.path).toBe("composed");
  });

  it("a calc over a zero baseline has no value, a calc fed by it has no value, and the run still answers", async () => {
    const steps = [
      specStep,
      { id: "c", kind: "calc", formula: "change", args: [{ name: "before", value: 0 }, { name: "after", value: "$a.value" }] },
      { id: "d", kind: "calc", formula: "rate", args: [{ name: "num", value: "$c.value" }, { name: "den", value: 2 }] },
    ];
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith(steps, ["d"])], critique: [pass], present: [presentFor("d")] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input("run-calc-null"))) as State;
    expect(out.error).toBeNull();
    expect(out.steps["c"]).toMatchObject({ status: "ok", value: null, explanation: "from 0 to 12 (+12); a relative change has no baseline at zero" });
    expect(out.steps["d"]).toMatchObject({ status: "ok", value: null, explanation: "no value: num ($c.value) has no value" });
    expect(out.answer).toBeTruthy();
    expect(calls).toEqual({ sketch: 1, plan: 2, critique: 1, present: 1 });
  });

  it("an entity pinned from a clarification chip needs no lookup and passes validation", async () => {
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [planWith([specStep])], critique: [pass], present: [presentation] });
    const deps = fakeDeps(client, { pins: [{ type: "student", id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" }] });
    const out = (await buildGraph(deps).invoke(input("run-pin"))) as State;
    expect(out.error).toBeNull();
    expect(out.resolved.entities[0]).toMatchObject({ id: 1203, label: "Bart Simpson" });
    expect(calls["plan"]).toBe(1);
    expect(out.answer).toBeTruthy();
  });

  it("a plan using an entity id that never came from a lookup fails validation and then the run", async () => {
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [planWith([specStep])], present: [presentation] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input("run-6"))) as State;
    expect(calls["plan"]).toBe(2);
    expect(out.error).toContain("did not come from lookup_entity");
    expect(deps.trace_steps.at(-1)).toBe("fail");
  });

  it("sketch failure still reaches plan with no episodes", async () => {
    const { client } = fakeClient({ sketch: [{ json: "garbage" }], plan: [{ toolUse: [lookupBart] }, planWith([specStep])], critique: [pass], present: [presentation] });
    const deps = fakeDeps(client);
    const out = (await buildGraph(deps).invoke(input("run-7"))) as State;
    expect(out.sketch_key).toBeNull();
    expect(out.answer).toBeTruthy();
  });

  it("chaos: crash after execute on attempt 1, resume on attempt 2 without re-running plan or execute", async () => {
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith([specStep])], critique: [pass], present: [presentation] });
    const checkpointer = new MemorySaver();
    const config = { configurable: { thread_id: "t-chaos" } };
    const deps1 = fakeDeps(client, { chaos: { crash_after: "execute" }, attempt: 1 });
    await expect(buildGraph(deps1, checkpointer).invoke({ ...input("run-8"), thread_id: "t-chaos" }, config)).rejects.toThrow(/chaos/);
    expect(deps1.trace_steps).toEqual(["sketch", "plan", "execute"]); // the crash leaves no row, like a real dead process

    const deps2 = fakeDeps(client, { chaos: { crash_after: "execute" }, attempt: 2, results: deps1.results });
    const out = (await buildGraph(deps2, checkpointer).invoke(null, config)) as State;
    expect(deps2.trace_steps).toEqual(["critique", "present"]);
    expect(out.answer).toBe("Bart took 12 passes.");
    expect(calls).toEqual({ sketch: 1, plan: 2, critique: 1, present: 1 });
  });

  it("naming a different Bart replaces the pin: a later bare Bart means the one named last", async () => {
    const reyesStep = { ...specStep, spec: { ...specStep.spec, entity: { type: "student", id: 1204 } } };
    const { client } = fakeClient({
      sketch: [sketch],
      plan: [{ toolUse: [lookupBart] }, planWith([specStep]), planWith([reyesStep]), { toolUse: [lookupBart] }, planWith([reyesStep])],
      critique: [pass],
      present: [presentation],
    });
    const checkpointer = new MemorySaver();
    const config = { configurable: { thread_id: "t-repin" } };
    let entityQueries = 0;
    const counting = (deps: ReturnType<typeof fakeDeps>) => {
      const base = deps.scopedQuery.bind(deps);
      deps.scopedQuery = async (p, sql, params) => { if (sql.includes("v_entities")) entityQueries += 1; return base(p, sql, params); };
      return deps;
    };
    // run 1: "Bart" goes to the database, resolves to Simpson and is pinned
    await buildGraph(counting(fakeDeps(client)), checkpointer).invoke({ ...input("run-11"), thread_id: "t-repin" }, config);
    expect(entityQueries).toBe(1);
    // run 2: the user clicks the Bart Reyes chip; the pin is replaced, not appended
    const deps2 = fakeDeps(client, { pins: [{ type: "student", id: 1204, label: "Bart Reyes", detail: "grade 11", text: "Bart Reyes" }] });
    const out2 = (await buildGraph(deps2, checkpointer).invoke({ ...input("run-12", "Same question for Bart Reyes"), thread_id: "t-repin" }, config)) as State;
    expect(out2.error).toBeNull();
    expect(out2.resolved.entities).toEqual([expect.objectContaining({ id: 1204, label: "Bart Reyes" })]);
    // run 3: a bare "Bart" now means Reyes, with no database lookup
    entityQueries = 0;
    const out3 = (await buildGraph(counting(fakeDeps(client)), checkpointer).invoke({ ...input("run-13", "And last week?"), thread_id: "t-repin" }, config)) as State;
    expect(out3.error).toBeNull();
    expect(entityQueries).toBe(0);
    expect(out3.lookups[0]).toMatchObject({ status: "resolved", candidates: [expect.objectContaining({ id: 1204 })] });
    expect(out3.resolved.entities.map((e) => e.id)).toEqual([1204]);
  });

  it("two entities named in one question both stay pinned", async () => {
    const lookupReyes = { name: "lookup_entity", input: { type: "student", text: "Bart Reyes", filters: { grade: null, period: null, section_id: null, teacher_id: null } } };
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart, lookupReyes] }, planWith([specStep])], critique: [pass], present: [presentation] });
    const deps = fakeDeps(client, {
      async scopedQuery(_p, sql, params) {
        if (sql.includes("v_school_days")) return { rows: ["2026-10-01", "2026-10-13"].map((d) => ({ d })), columns: ["d"] };
        if (sql.includes("v_entities")) {
          const text = String(params[0]);
          return { rows: text === "Bart Reyes" ? [{ id: 1204, label: "Bart Reyes", detail: "11th", confidence: 1 }] : [{ id: 1203, label: "Bart Simpson", detail: "9th", confidence: 0.6 }, { id: 1204, label: "Bart Reyes", detail: "11th", confidence: 0.4 }], columns: [] };
        }
        if (sql.includes("v_my_history")) return { rows: [], columns: [] };
        return { rows: [{ value: 12 }], columns: ["value"] };
      },
    });
    const out = (await buildGraph(deps).invoke(input("run-14", "Compare Bart and Bart Reyes"))) as State;
    expect(out.error).toBeNull();
    expect(out.resolved.entities.map((e) => e.id).sort()).toEqual([1203, 1204]);
  });

  it("pins persist across runs in a thread: the second run needs no lookup", async () => {
    const { client, calls } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith([specStep]), planWith([specStep])], critique: [pass], present: [presentation] });
    const checkpointer = new MemorySaver();
    const config = { configurable: { thread_id: "t-pin" } };
    const deps = fakeDeps(client);
    const g = buildGraph(deps, checkpointer);
    await g.invoke({ ...input("run-9"), thread_id: "t-pin" }, config);
    const out = (await g.invoke({ ...input("run-10", "And last week?"), thread_id: "t-pin" }, config)) as State;
    expect(out.resolved.entities).toHaveLength(1);
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(out.answer).toBeTruthy();
    expect(calls["plan"]).toBe(3);
  });

  it("state stays small: a 500-row result goes to the store, never into graph state (design 5, state.size)", async () => {
    const grouped = { ...specStep, spec: { ...specStep.spec, group_by: ["student"], limit: 500 } };
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBart] }, planWith([grouped])], critique: [pass], present: [presentation] });
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({ student: 1000 + i, value: 500 - i }));
    const deps = fakeDeps(client);
    const base = deps.scopedQuery.bind(deps);
    // the compiled statement is the only query that starts with a bare SELECT and a newline (lookups, school days and history do not)
    deps.scopedQuery = async (p, sql, params) => (sql.startsWith("SELECT\n") ? { rows, columns: ["student", "value"] } : base(p, sql, params));
    const out = (await buildGraph(deps).invoke(input("run-15", "Which of Bart's classmates take the most passes?"))) as State;
    expect(out.error).toBeNull();
    expect(out.steps["a"]).toMatchObject({ status: "ok", row_count: 500, shape: "categories" });
    expect(deps.store.get("run-15/a")).toHaveLength(500);
    const serialized = JSON.stringify(out);
    expect(serialized.length).toBeLessThan(32 * 1024);
    expect(serialized).not.toContain('"student":1499');
  });

  it("a section chip answers the nameless section lookup of its run instead of asking the same question again", async () => {
    const section = { type: "section" as const, id: 58, label: "Biology, period 4 (Edna Krabappel)", detail: "period 4, Edna Krabappel", text: "Biology, period 4 (Edna Krabappel)" };
    const lookupClass = { name: "lookup_entity", input: { type: "section", text: "my class", filters: { grade: null, period: null, section_id: null, teacher_id: null } } };
    const sectionStep = { id: "a", kind: "spec", spec: { metric: "attendance_rate", entity: { type: "section", id: 58 }, time_range: { start: "2026-10-01", end: "2026-10-13" } } };
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupClass] }, planWith([sectionStep])], critique: [pass], present: [presentation] });
    let entityQueries = 0;
    const deps = fakeDeps(client, { pins: [section] });
    const base = deps.scopedQuery.bind(deps);
    deps.scopedQuery = async (p, sql, params) => { if (sql.includes("v_entities")) entityQueries += 1; return base(p, sql, params); };
    const out = (await buildGraph(deps).invoke(input("run-16", "How many more classes does Bart need to hit 90% in my class?"))) as State;
    expect(out.error).toBeNull();
    expect(entityQueries).toBe(0);
    expect(out.lookups[0]).toMatchObject({ type: "section", text: "my class", status: "resolved", candidates: [expect.objectContaining({ id: 58 })] });
    expect(out.plan_output).toMatchObject({ kind: "plan" });
    expect(out.resolved.entities.map((e) => e.id)).toContain(58);
  });

  it("after a parse-error correction the planner keeps its tool rounds, and a repeated lookup keeps the chip's answer (run 9a207dea)", async () => {
    const section = { type: "section" as const, id: 58, label: "Biology, period 4 (Edna Krabappel)", detail: "period 4, Edna Krabappel", text: "Biology, period 4 (Edna Krabappel)" };
    const lookupClass = { name: "lookup_entity", input: { type: "section", text: "my class", filters: { grade: null, period: null, section_id: null, teacher_id: null } } };
    const sectionStep = { id: "a", kind: "spec", spec: { metric: "attendance_rate", entity: { type: "section", id: 58 }, time_range: { start: "2026-10-01", end: "2026-10-13" } } };
    // what run 9a207dea's planner wrote: a lookup filter used as a spec filter, which the strict Filters schema rejects
    const rejected = planWith([{ ...sectionStep, spec: { ...sectionStep.spec, filters: { section_id: 58 } } }]);
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupClass] }, rejected, { toolUse: [lookupClass] }, planWith([sectionStep])], critique: [pass], present: [presentation] });
    const planRequests: { role: string }[][] = [];
    const create = client.messages.create.bind(client.messages);
    client.messages.create = async (params, options) => {
      const sys = typeof params.system === "string" ? params.system : (params.system ?? []).map((b) => b.text).join("\n");
      if (sys.startsWith("You are the planner")) planRequests.push(params.messages.map((m) => ({ role: m.role })));
      return create(params, options);
    };
    // the search alone ties every section for "my class", as it did live
    const sections = [56, 57, 58, 59, 60].map((id, i) => ({ id, label: `Biology, period ${[1, 2, 4, 6, 7][i]} (Edna Krabappel)`, detail: "", confidence: 0 }));
    let entityQueries = 0;
    const deps = fakeDeps(client, { pins: [section] });
    const base = deps.scopedQuery.bind(deps);
    deps.scopedQuery = async (p, sql, params) => {
      if (sql.includes("v_entities")) { entityQueries += 1; return { rows: sections, columns: [] }; }
      return base(p, sql, params);
    };
    const out = (await buildGraph(deps).invoke(input("run-17", "How many more classes does Bart need to hit 90% in my class?"))) as State;
    expect(out.error).toBeNull();
    expect(out.plan_output).toMatchObject({ kind: "plan" });
    expect(entityQueries).toBe(0);
    expect(out.lookups.map((l) => [l.text, l.status, l.candidates[0]?.id])).toEqual([["my class", "resolved", 58], ["my class", "resolved", 58]]);
    // the corrective round continues the failed conversation: question, tool_use, tool_result, the rejected reply, the correction
    expect(planRequests[2]!.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });

  it("a person chip answers the surname lookup of its run instead of tying the two Simpsons again", async () => {
    const bart = { type: "student" as const, id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
    const lookupSimpson = { name: "lookup_entity", input: { type: "student", text: "Simpson", filters: { grade: null, period: null, section_id: null, teacher_id: null } } };
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupSimpson] }, planWith([specStep])], critique: [pass], present: [presentation] });
    let entityQueries = 0;
    const deps = fakeDeps(client, { pins: [bart] });
    const base = deps.scopedQuery.bind(deps);
    deps.scopedQuery = async (p, sql, params) => {
      if (sql.includes("v_entities")) { entityQueries += 1; return { rows: [{ id: 1203, label: "Bart Simpson", detail: "grade 9", confidence: 0.9 }, { id: 1205, label: "Lisa Simpson", detail: "grade 7", confidence: 0.9 }], columns: [] }; }
      return base(p, sql, params);
    };
    const out = (await buildGraph(deps).invoke(input("run-18", "How many passes did Simpson take this month?"))) as State;
    expect(out.error).toBeNull();
    expect(out.plan_output).toMatchObject({ kind: "plan" });
    expect(entityQueries).toBe(0);
    expect(out.lookups).toEqual([expect.objectContaining({ text: "Simpson", status: "resolved", candidates: [expect.objectContaining({ id: 1203 })] })]);
  });

  it("an inherited pin evicted by a same-first-name lookup in the same run stays a valid id for that run's plan", async () => {
    const simpson = { type: "student" as const, id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
    const lookup = (text: string) => ({ name: "lookup_entity", input: { type: "student", text, filters: { grade: null, period: null, section_id: null, teacher_id: null } } });
    const both = [
      { id: "a", kind: "spec", spec: { metric: "pass_count", entity: { type: "student", id: 1203 }, time_range: { start: "2026-10-01", end: "2026-10-13" } } },
      { id: "b", kind: "spec", spec: { metric: "pass_count", entity: { type: "student", id: 1204 }, time_range: { start: "2026-10-01", end: "2026-10-13" } } },
    ];
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookup("Bart Simpson"), lookup("Bart Reyes")] }, planWith(both, ["a", "b"])], critique: [pass], present: [presentation] });
    const deps = fakeDeps(client);
    const base = deps.scopedQuery.bind(deps);
    deps.scopedQuery = async (p, sql, params) => (sql.includes("v_entities") && String(params?.[0]).includes("Reyes")
      ? { rows: [{ id: 1204, label: "Bart Reyes", detail: "grade 11", confidence: 1 }], columns: [] }
      : base(p, sql, params));
    const out = (await buildGraph(deps).invoke({ ...input("run-19", "Compare Bart Simpson and Bart Reyes this month"), resolved: { entities: [simpson], dates: [] } })) as State;
    expect(out.error).toBeNull();
    expect(out.plan_output).toMatchObject({ kind: "plan" });
    // both stay pinned for this run, so the critic and the writer can name both ids
    expect(out.resolved.entities.map((e) => e.id).sort()).toEqual([1203, 1204]);
  });

  it("a planner that asks the user to choose again what they chose by chip gets one correction, then answers", async () => {
    const bart = { type: "student" as const, id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
    const askAgain = { json: { kind: "out_of_scope", reason: "needs_clarification", message: "Which Bart?", options: [{ label: "Bart Simpson", entity: { type: "student", id: 1203 } }, { label: "Bart Reyes", entity: { type: "student", id: 1204 } }] } };
    const { client } = fakeClient({ sketch: [sketch], plan: [askAgain, planWith([specStep])], critique: [pass], present: [presentation] });
    const lastUser: string[] = [];
    const create = client.messages.create.bind(client.messages);
    client.messages.create = async (params, options) => {
      const m = params.messages[params.messages.length - 1];
      if (m && typeof m.content === "string") lastUser.push(m.content);
      return create(params, options);
    };
    const out = (await buildGraph(fakeDeps(client, { pins: [bart] })).invoke(input("run-20", "How many passes did Bart take this month?"))) as State;
    expect(out.error).toBeNull();
    expect(out.plan_output).toMatchObject({ kind: "plan" });
    expect(out.retries.corrective).toBe(1);
    expect(lastUser.some((t) => t.includes("already chose Bart Simpson"))).toBe(true);
  });

  it("with no correction left, a clarification that repeats the chosen entity stands instead of failing the run", async () => {
    const bart = { type: "student" as const, id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
    const askAgain = { json: { kind: "out_of_scope", reason: "needs_clarification", message: "Which Bart?", options: [{ label: "Bart Simpson", entity: { type: "student", id: 1203 } }] } };
    const { client } = fakeClient({ sketch: [sketch], plan: [askAgain, askAgain], present: [presentation] });
    const out = (await buildGraph(fakeDeps(client, { pins: [bart] })).invoke(input("run-21", "How many passes did Bart take this month?"))) as State;
    expect(out.error).toBeNull();
    expect(out.plan_output).toMatchObject({ kind: "out_of_scope", reason: "needs_clarification" });
  });

  it("a tie that contains the clicked entity resolves to it whatever the lookup's words (no word rule needed)", async () => {
    const bart = { type: "student" as const, id: 1203, label: "Bart Simpson", detail: "grade 9", text: "Bart Simpson" };
    const lookupBoy = { name: "lookup_entity", input: { type: "student", text: "the Simpson boy", filters: { grade: null, period: null, section_id: null, teacher_id: null } } };
    const { client } = fakeClient({ sketch: [sketch], plan: [{ toolUse: [lookupBoy] }, planWith([specStep])], critique: [pass], present: [presentation] });
    const deps = fakeDeps(client, { pins: [bart] });
    const base = deps.scopedQuery.bind(deps);
    deps.scopedQuery = async (p, sql, params) => (sql.includes("v_entities")
      ? { rows: [{ id: 1203, label: "Bart Simpson", detail: "grade 9", confidence: 0.9 }, { id: 1205, label: "Lisa Simpson", detail: "grade 7", confidence: 0.9 }], columns: [] }
      : base(p, sql, params));
    const out = (await buildGraph(deps).invoke(input("run-22", "How many passes did the Simpson boy take this month?"))) as State;
    expect(out.error).toBeNull();
    expect(out.plan_output).toMatchObject({ kind: "plan" });
    expect(out.lookups).toEqual([expect.objectContaining({ text: "the Simpson boy", status: "resolved", candidates: [expect.objectContaining({ id: 1203 })] })]);
  });
});
