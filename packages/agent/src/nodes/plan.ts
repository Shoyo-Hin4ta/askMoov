import { MAX_CORRECTIVE_CALLS, PlannerOutput, type OutOfScope, type Persona } from "@ask-moov/shared";
import type { AgentDeps } from "../deps";
import { LlmParseError, PlanValidationError } from "../errors";
import { renderEpisodes, templatize } from "../episodes";
import { MODELS, type MessageParam } from "../llm";
import { validatePlan } from "../plan-check";
import { plannerSystem, plannerTools } from "../prompts";
import type { State, StateUpdate, LookupRecord } from "../state";
import { allPins, chosenFor, lookupEntity, pinEntity, type LookupFilters, type LookupResult, type PinSet, type ResolvedEntity } from "../tools/lookup-entity";
import { everyDay, resolveDates, type ResolvedDates } from "../tools/resolve-dates";
import { errorText, isFatal, pathOf, runBudget, threadMessages } from "./shared";

type LookupInput = { type: ResolvedEntity["type"]; text: string; filters: { grade: number | null; period: number | null; section_id: number | null; teacher_id: number | null } };

export async function planNode(state: State, deps: AgentDeps): Promise<StateUpdate> {
  const persona = state.persona;
  // Pins from earlier runs, then whatever this run names. A chip click arrives by id and is pinned before the model runs,
  // so no lookup re-decides it; naming a different student replaces the old pin of that name (pinEntity).
  let pins: PinSet = { inherited: [...state.resolved.entities], added: [] };
  for (const p of deps.pins) pins = pinEntity(pins, p);
  const entities = (): ResolvedEntity[] => allPins(pins);
  // The chips clicked for this run, each answering one lookup of its type (chosenFor); people still match by name.
  const chosen: ResolvedEntity[] = [...deps.pins];
  const dates: (ResolvedDates & { text: string })[] = [...state.resolved.dates];
  const lookups: LookupRecord[] = [...state.lookups];

  let episodes = state.episodes;
  if (deps.episodes && state.sketch_key && episodes.length === 0 && state.retries.plan === 0) {
    episodes = await deps.episodes.retrieve({ sketch: state.sketch_key, role: persona.role, questionTemplated: templatize(state.question, state.resolved.entities, state.resolved.dates.map((d) => d.text)), schemaVersion: state.schema_version }); // same form as the stored keys; pinned names become {student} on later turns
  }

  const scoped = (sql: string, params: unknown[]) => deps.scopedQuery(persona, sql, params).then((r) => r.rows);
  const today = deps.frozenNow.slice(0, 10);
  const schoolDays = async (start: string, end: string) =>
    (await scoped("SELECT date::text AS d FROM analytics.v_school_days WHERE date BETWEEN $1 AND $2 ORDER BY date", [start, end])).map((r) => String(r["d"]));

  const onToolUse = async (name: string, input: unknown): Promise<unknown> => {
    const started = Date.now();
    let result: unknown;
    try {
      if (name === "lookup_entity") {
        const i = input as LookupInput;
        const filters: LookupFilters = {};
        for (const k of ["grade", "period", "section_id", "teacher_id"] as const) if (i.filters?.[k] != null) filters[k] = i.filters[k]!;
        const chip = chosenFor(chosen, i.type, i.text);
        let r: LookupResult;
        if (chip) {
          chosen.splice(chosen.indexOf(chip), 1);
          const match = { type: chip.type, id: chip.id, label: chip.label, detail: chip.detail, confidence: 1 };
          r = { status: "resolved", match, candidates: [match] };
        } else {
          r = await lookupEntity(scoped, entities(), i.type, i.text, filters);
        }
        lookups.push({ type: i.type, text: i.text, status: r.status, candidates: r.candidates });
        if (r.status === "resolved") pins = pinEntity(pins, { type: r.match.type, id: r.match.id, label: r.match.label, detail: r.match.detail, text: i.text });
        result = r;
      } else if (name === "resolve_dates") {
        const q = input as { phrase?: string; clock?: string | null };
        const text = String(q.phrase ?? "");
        // Two clocks: data lives on the frozen timeline and school days; history (ops.runs) is stamped in real time and spans every calendar day.
        const history = q.clock === "history";
        const r = await resolveDates(input, history ? new Date().toISOString().slice(0, 10) : today, history ? everyDay : schoolDays);
        if (!dates.some((d) => d.text === text)) dates.push({ ...r, text });
        result = r;
      } else {
        throw new Error(`unknown tool ${name}`);
      }
      return result;
    } finally {
      await deps.trace.toolCall({ run_id: state.run_id, node: "plan", tool: name, args: input, result: result ?? null, duration_ms: Date.now() - started });
    }
  };

  const recentHistory = await recentHistoryText(deps, persona);
  const system = plannerSystem({
    schemaDoc: deps.schemaDoc, frozenNow: deps.frozenNow, episodesText: renderEpisodes(episodes),
    entities: entities(), dates, recentHistory, replanContext: state.replan_context,
  });

  let corrective = state.retries.corrective;
  const base: MessageParam[] = threadMessages(state).map((m) => ({ role: m.role, content: m.content }));
  let messages: MessageParam[] = base;
  try {
    for (;;) {
      let output: PlannerOutput, transcript: MessageParam[];
      try {
        ({ output, messages: transcript } = await deps.llm.callStructured({
          node: "plan", model: MODELS.main, schema: PlannerOutput, formatSchema: null, system, messages, tools: plannerTools(), onToolUse, effort: "medium", max_tokens: 16_000, budget: runBudget(state),
        }));
      } catch (e) {
        // schema-invalid JSON gets the same single correction as a schema-valid but wrong plan
        if (e instanceof LlmParseError && corrective < MAX_CORRECTIVE_CALLS) {
          corrective += 1;
          messages = [...base, { role: "user", content: `Your previous reply did not match the required shape: ${e.message}. Reply with the JSON object only, using exactly the field names and allowed values from the rules.` }];
          continue;
        }
        throw e;
      }
      const checked = postCheck(output, persona, entities(), lookups);
      if (checked.ok) {
        return {
          plan_output: checked.plan, episodes, lookups, resolved: { entities: entities(), dates }, retries: { ...state.retries, corrective },
          replan_context: null, error: null, last_node: "plan",
          path: checked.plan.kind === "plan" ? pathOf(checked.plan) : state.path,
        };
      }
      if (corrective >= MAX_CORRECTIVE_CALLS) throw new PlanValidationError(checked.reason);
      corrective += 1;
      messages = [
        ...transcript,
        { role: "assistant", content: JSON.stringify(output) },
        { role: "user", content: `That plan failed validation: ${checked.reason}\nReturn a corrected plan. Keep every entity id from the lookups above.` },
      ];
    }
  } catch (e) {
    if (isFatal(e)) return { error: errorText(e), lookups, resolved: { entities: entities(), dates }, retries: { ...state.retries, corrective }, last_node: "plan" };
    throw e;
  }
}

/** The two post-planner checks from design doc 4.5a plus validatePlan. */
function postCheck(output: PlannerOutput, persona: Persona, entities: ResolvedEntity[], lookups: LookupRecord[]): { ok: true; plan: PlannerOutput } | { ok: false; reason: string } {
  if (output.kind === "out_of_scope") return { ok: true, plan: output.reason === "needs_clarification" ? withCandidateEntities(output, lookups) : output };
  const ambiguous = lookups.find((l) => l.status === "ambiguous");
  if (ambiguous) {
    const clarification: OutOfScope = {
      kind: "out_of_scope",
      reason: "needs_clarification",
      message: `Which ${ambiguous.type} do you mean by "${ambiguous.text}"?`,
      options: ambiguous.candidates.slice(0, 5).map((c) => ({ label: c.detail ? `${c.label}, ${c.detail}` : c.label, entity: { type: c.type, id: c.id, label: c.label, detail: c.detail } })),
    };
    return { ok: true, plan: clarification };
  }
  try {
    validatePlan(output, persona, entities.map((e) => ({ type: e.type, id: e.id })));
    return { ok: true, plan: output };
  } catch (e) {
    if (e instanceof PlanValidationError) return { ok: false, reason: e.message };
    throw e;
  }
}

/**
 * The model writes the chips' labels; the entity behind each chip is code's. An option whose id came from a lookup candidate
 * carries that candidate's name and detail, so a click can pin it. An option whose id came from nowhere loses its entity and
 * is sent back as plain text: only code-sourced ids become pins (design 4.5a).
 */
function withCandidateEntities(o: OutOfScope, lookups: LookupRecord[]): OutOfScope {
  if (!o.options?.length) return o;
  type Candidate = LookupRecord["candidates"][number];
  const byId = new Map<string, Candidate>(lookups.flatMap((l) => l.candidates.map((c): [string, Candidate] => [`${c.type}:${c.id}`, c])));
  return {
    ...o,
    options: o.options.map((opt) => {
      if (!opt.entity) return opt;
      const c = byId.get(`${opt.entity.type}:${opt.entity.id}`);
      if (!c) { const { entity: _dropped, ...rest } = opt; return rest; }
      return { ...opt, entity: { type: c.type, id: c.id, label: c.label, detail: c.detail } };
    }),
  };
}

async function recentHistoryText(deps: AgentDeps, persona: Persona): Promise<string> {
  const { rows } = await deps.scopedQuery(
    persona,
    `SELECT entity_type, entity_id, entity_label, count(*) AS n, max(asked_at) AS last_asked
     FROM analytics.v_my_history
     WHERE asked_at >= now() - interval '30 days' AND entity_type IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY last_asked DESC LIMIT 5`,
    [],
  ).catch(() => ({ rows: [], columns: [] }));
  return rows.map((r) => `- ${r["entity_type"]} ${r["entity_id"]}: ${r["entity_label"]} (asked ${r["n"]} times, last ${String(r["last_asked"]).slice(0, 10)})`).join("\n");
}
