# Ask MOOV: Design and Build Plan

Status: v1.2, October 24, 2026. Owner: Ritik. Audience: Claude Code and anyone reviewing the repo. v1.2 describes the system as built and deployed; every difference from v1.1 is listed in section 20. The running checklist is `docs/PLAN.md`; the narrative of each decision is in `docs/sessions/`.

---

## 0. What this is

Ask MOOV is a production-grade analytics agent over school tap data in the shape MOOV (joinmoov.com) collects: ID card taps on classroom readers, entry kiosks and staff handhelds, plus the hall passes and attendance derived from those taps. A teacher, building admin or district admin asks a question in plain English and gets an answer, a chart, and the SQL that produced it, scoped to exactly the data their role is allowed to see.

It runs on synthetic data for a fictional district (Springfield High, plus a smaller Shelbyville High so district scope means something). The agent is the product. The data is the stage.

What it is not: a MOOV clone, a dashboard, a RAG system, a multi-agent system, a demo that runs inline in a request handler.

---

## 1. Principles (non-negotiable)

1. **LLM decides content, code decides control.** The graph is fixed. The LLM fills in a plan. Code runs it. The LLM never picks the next node.
2. **Data scope is enforced in Postgres, never in a prompt.** The query connection runs with the caller's role, user id and school id as session variables, and row-level security does the rest. The agent physically cannot read rows outside scope. The model is never told who is asking.
3. **The LLM never does arithmetic.** Anything over rows is SQL. Anything over a few scalars is the `calc` tool. The presenter quotes numbers that code computed; it never derives one.
4. **The LLM never writes SQL unless it has to.** Known question shapes compile from a structured spec. Free-form SQL (tier 3) is the escape hatch, and it is parsed, allowlisted, and EXPLAINed before it runs.
5. **Schema knowledge comes from migrations.** Views plus `COMMENT ON` plus a small notes table, introspected from the catalog. No hand-maintained schema doc. The same loader feeds the planner and the `/schema` page.
6. **Every run is resumable and every step is recorded.** LangGraph checkpoints after every node. `runs`, `run_steps`, `llm_calls` (with the full request and response of every model round), `tool_calls`, `run_results` and `run_output` in Postgres are the trace.
7. **The agent says what it measured and what it inferred.** Reader offline during the window, dwell time inferred from the next tap, scope-limited results, rooms outside any wing. These are first-class caveats, not footnotes.

---

## 2. Architecture

```
┌──────── Next.js 16 on Vercel (Fluid compute) ──────────────┐
│ Chat UI · persona switch · thread list · answer cards     │
│ /ops (aggregates) · /ops/runs/[id] (one run's trace)      │
│ /schema (views, policies, grants, read from the catalog)  │
│ POST /api/ask          budget check, insert run, ping     │
│                        worker, return 202                 │
│ POST /api/worker       claim run, return 202, run graph   │
│                        after the response (maxDuration 300)│
│ GET  /api/runs/[id]    status, trail, output, labels, vote │
│ GET  /api/runs/[id]/trace   full trace of one run         │
│ GET  /api/threads, /api/threads/[id]                      │
└──────────┬───────────────────▲─────────────────────────────┘
           │ pg (pooler :6543)  │ HTTPS via pg_net
           ▼                   │
┌──────── Supabase Postgres 17 ──────────────────────────────┐
│ public:    dimension tables, passes, attendance, cards,     │
│            devices, and three derived event tables          │
│            (presence_events, entry_events, device_hours)    │
│ analytics: 11 views, security_invoker, RLS applies          │
│ ops:       runs, run_steps, run_results, run_output,        │
│            run_entities, llm_calls, tool_calls,             │
│            prompt_blocks, schema_meta                       │
│ memory:    episodes, episode_feedback, domain_notes,        │
│            schema_examples                                  │
│ langgraph: checkpoints                                      │
│ vault:     app_url, worker_secret                           │
│ pg_cron:   every minute ops.redispatch(); nightly           │
│            ops.retention()                                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Request lifecycle

1. UI posts `{run_id, thread_id, persona, question, pin?}` to `/api/ask`. `run_id` is a client-generated UUID and the idempotency key. `pin` is the entity the user chose by clicking a clarification chip, carried by id so no lookup has to re-decide it.
2. `/api/ask` checks the monthly token budget: `sum(prompt_tokens + completion_tokens)` over `ops.llm_calls` for the current UTC month against `MONTHLY_TOKEN_BUDGET`. Over budget returns 429 with the numbers. Otherwise it inserts `ops.runs` with `status = 'queued'`, `queued_at = now()`, `git_sha` and `pins`. Duplicate `run_id` is a no-op (`ON CONFLICT DO NOTHING`).
3. `/api/ask` POSTs `{run_id}` to `APP_URL/api/worker` with the `x-worker-secret` header (the ping), after its own response. It never waits for the run. A failed ping is swallowed; the cron is the guarantee.
4. `/api/worker` verifies the secret, then claims the run: `UPDATE ops.runs SET status='running', claimed_at=now(), heartbeat_at=now(), attempt=attempt+1 WHERE id=$1 AND status='queued' RETURNING *`. No row back means another invocation has it. Otherwise it returns 202 and runs the graph in Next.js's `after()` hook, which keeps the function alive up to `maxDuration = 300`.
5. The graph runs with `thread_id`. If the thread's latest checkpoint belongs to this run and has a next node, execution resumes there without redoing finished nodes.
6. After each node: a `run_steps` row and `runs.current_node`. Liveness is separate: a 30 s timer writes `runs.heartbeat_at` while the worker holds the claim (`status = 'running'` on the claimed attempt), stops at the run budget so a hung worker falls silent, and stops when the lease is lost.
7. The UI polls `GET /api/runs/[id]` every second while status is `queued` or `running`. The browser never holds a database key.
8. On success: `run_results`, `run_output` (answer, chart spec, caveats, SQL per step, the plan, names for id columns), `run_entities`, an episode if the critic passed, then `status='succeeded'`. Model-round trace rows are written without blocking the rounds and settled before the status flips, so succeeded means fully recorded.
9. On error: `status='failed'` if the error is non-retryable (refusal, truncation, budget, validation exhausted) or `attempt >= 3`. Otherwise `status='queued'` and one self-ping.
10. pg_cron every minute calls `ops.redispatch()`: stale running runs (`heartbeat_at` older than 2 minutes) go back to `queued` if `attempt < 3`, else `failed`; a run nobody claims within 10 minutes of being queued is failed; every run queued over a minute is POSTed to `/api/worker` through pg_net. This is the guarantee; the ping is the fast path. Verified on the deployment: a hand-requeued run was posted at the next minute, Vercel answered 202, the worker finished it on attempt 2.
11. UI renders the answer, the chart from the step the presenter named, the caveats, the SQL per step, the thumbs, and a Trace link.

### 2.2 Stack

| Layer | Choice | Why |
| :---- | :---- | :---- |
| Web + API | Next.js 16 (App Router, Turbopack), React 19, Vercel Fluid compute | 300 s function cap on Hobby is enough for 5 to 10 model calls. |
| Status transport | UI polls `GET /api/runs/[id]` every second | No Realtime, no websockets, no database key in the browser. |
| Agent runtime | LangGraph.js 1.5 + `@langchain/langgraph-checkpoint-postgres` | Checkpointing per node for free. |
| LLM | `@anthropic-ai/sdk` 1.1. `claude-opus-5-5` for plan, critique, present; `claude-haiku-5-5` for sketch. Structured outputs (`zodOutputFormat`) for sketch, critique and present; the planner answers in plain JSON parsed strictly in code. | The planner's nested schema exceeds the compiled-grammar limit. Prompt caching on the static prefix. |
| Database | Supabase Postgres 17, pg_trgm, pg_cron, pg_net, Vault | One database for domain, ops, memory, checkpoints, queue, secrets. No vector extension. |
| SQL safety | `libpg-query` (Postgres parser in WebAssembly) | Real parser, not regex. |
| Charts | Recharts behind a `VizRenderer` | The model never sees the library. |
| Tests | Vitest 4 | Unit (211), database (24), golden evals (90). |
| Package manager | npm workspaces | No extra tooling. |

### 2.3 Repo layout

```
apps/web                 Next.js app: UI, API routes, /ops, /ops/runs/[id], /schema
packages/agent           graph, nodes, tools, compiler, validator, facts, labels, prompts, llm wrapper, heartbeat, runtime
packages/db              pools, ops data access, transcripts, seed, role and Vault setup, authorization tests
packages/shared          Zod schemas (Plan, Spec, Sketch, VizSpec, Persona, Pin), metric registry, personas, viz rules
packages/evals           golden set (90 cases) and two-pass runner
supabase/migrations      22 plain-SQL migrations, applied with the Supabase CLI
scripts                  ask one question end to end; print the planner's schema document
docs                     this document, PLAN.md, HANDOFF.md, session logs
```

---

## 3. Phase ordering and dependencies

| Phase | Deliverable | Depends on |
| :---- | :---- | :---- |
| 1 | Agentic structure: graph (with `sketch`), state, schemas, tools, compiler, validator, prompts, LLM wrapper | nothing |
| 2 | Verify structure: unit tests, no database | 1 |
| 3 | Migrations: domain, analytics views, roles, RLS, ops, memory, checkpoints, cron | nothing |
| 4 | Seed: deterministic generator with planted stories | 3 |
| 5 | Authorization: RLS policies live, persona context, scope tests | 3, 4 |
| 6 | Observability: ops tables wired, `/ops`, transcripts, run trace | 1, 3 |
| 7 | Durability: `/api/ask` with budget check, `/api/worker`, ping, re-dispatch cron, heartbeat, chaos flag | 1, 3, 6 |
| 8 | Memory: checkpointer, entity pinning, episodes with sketch-keyed retrieval, feedback votes | 3, 7 |
| 9 | Evals: golden set, runner (episodes off and on) | 4, 7, 8 |
| 10 | Frontend: chat, persona switch, thread list, VizRenderer, SQL reveal, thumbs, `/ops`, `/schema`, run detail | everything |

All ten phases are built, verified and deployed (`docs/PLAN.md`).

---

## 4. Phase 1: Agentic structure

### 4.1 Graph

```
sketch → plan → execute → critique → present
          ▲       │          │
          └───────┴──────────┘   (replan, max 2)
```

Six nodes. `intake` is folded into `plan` as pre-processing. `classify` is folded into `plan` as an output variant.

| Node | LLM? | Does |
| :---- | :---- | :---- |
| `sketch` | yes, `claude-haiku-5-5` | Given the question and the metric names only: `{metrics, entity_types, shape}`. Used solely as the episode retrieval key (11.2). Never sees the schema doc. Fails open. |
| `plan` | yes | Load the schema doc from the process cache, resolve entities and dates via tools, retrieve up to 3 episodes by sketch key (code, not a tool), emit `Plan` or `OutOfScope` as plain JSON. Then the post-planner code checks (4.5a), plan validation and a compile of every spec. On a schema miss or an invalid plan, one corrective call with the error attached. |
| `execute` | tier 3 only | One plan step per visit, so every step gets its own checkpoint. Resolve `$refs`, compile (spec) or accept (sql), validate, EXPLAIN, run on the scoped connection, store rows. Collect caveats. |
| `critique` | yes | Given the question, the resolved entities, each step's definition and SQL, up to 5 sample rows with ids written as names, a facts block code computed over the full result, and the caveats: `{pass, reason, fixes?}`. Sees no planner reasoning. |
| `present` | yes | Given the same material plus the chart type code derived per candidate step: `{answer_md, viz}` where `viz.step` names the step the chart is drawn from. Code checks the chart can be drawn from that step; one corrective call; then a named error. |
| `fail` | no | Terminal. Writes the reason to `runs.error`. |

Edges:

- `sketch` → `plan` always. Replans return to `plan`, never to `sketch`.
- `plan` → `present` if `OutOfScope` (present renders the message; for `needs_clarification` the UI renders `options` as chips, and the run ends there).
- `plan` → `execute` otherwise; `execute` → `execute` while steps remain.
- `execute` → `critique` on success. `execute` → `plan` with the rejection attached if a tier-3 step fails validation or SQL (`retries.sql < 2`). `execute` → `fail` on a fatal error.
- `critique` → `present` on pass. `critique` → `plan` with the critique attached if `retries.plan < 2`. `critique` → `present` with `uncertain = true` otherwise.

Hard limits: 4 steps per plan, 2 replans, 2 SQL regenerations per step, 1 corrective planner call per attempt, 1 corrective presenter call, 240 s run budget checked before every model round and between steps, 90 s deadline on every model call (body included), 5 s statement timeout per query, `RUN_TOKEN_CAP` tokens per run spanning attempts (4.13), 30 s heartbeat.

### 4.2 State

```ts
type State = {
  run_id: string; thread_id: string;
  persona: Persona;                        // { role, user_id, school_id, scope_summary, chaos? }; never shown to the model
  question: string;
  messages: ChatMessage[];                 // appends across runs in a thread; the last 10 turns reach the planner
  resolved: { entities: ResolvedEntity[]; dates: ResolvedDates[] };   // pins; persist across runs in a thread
  lookups: LookupRecord[];                 // every lookup this run made, with its status and candidates
  sketch_key: Sketch | null;
  episodes: EpisodeRef[];                  // ids, templated question, plan
  plan_output: Plan | OutOfScope | null;
  step_index: number;
  steps: Record<string, StepResult>;       // { status, kind, sql?, params?, shape?, value?, row_count?, columns?, explanation?, error? }
  caveats: Caveat[];                       // { kind, text, step_id? }
  critic_verdict: Critique | null;
  viz: VizSpec | null;
  answer: string | null;
  uncertain: boolean;
  retries: { plan: number; sql: number; corrective: number };
  error: string | null;                    // fatal only; the router sends the run to fail
  replan_context: string | null;           // the critic's verdict or the rejected SQL, for the next planner attempt
  path: "compiled" | "composed" | "generated" | null;
  last_node: string | null;
  schema_version: string; git_sha: string; started_at: number;
};
```

Not in state: the schema doc, result rows, raw episode text. Rows go to `ops.run_results`. A 500-row result keeps the serialized state under 32 KB (tested). Channel names never equal node names (`sketch_key`, `plan_output`, `critic_verdict`).

### 4.3 Plan schema

```ts
const CalcArg  = z.strictObject({ name: z.string(), value: z.union([z.number(), z.string()]) });   // string = "$step.path"
const Step = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: "spec", spec: Spec }),
  z.strictObject({ id, kind: "calc", formula: z.string(), args: z.array(CalcArg) }),
  z.strictObject({ id, kind: "sql",  sql: z.string(), reason: z.string() }),                       // tier 3
]);
const Plan = z.strictObject({ kind: "plan", steps: z.array(Step), answer_from: z.array(z.string()), expected_shape: Shape });
const OutOfScope = z.strictObject({
  kind: "out_of_scope",
  reason: z.enum(["not_in_data","identity","action","permission","advice_or_prediction","needs_clarification"]),
  message: z.string(), suggestion: z.string().optional(),
  options: z.array(z.strictObject({ label, entity: { type, id, label?, detail? }.optional() })).optional(),   // needs_clarification only
});
```

Every object is strict: an unknown key (a hallucinated filter, a field from an older spec) is a parse error that gets the one corrective call, never a silent drop. Calc args are a list, not a record, because closed object schemas need fixed keys. Step count, refs, metric and filter pairing and entity provenance are checked by `validatePlan` in code, not by the schema.

References: `"$a.value"`, `"$a.row_count"`, `"$a.rows[0].student_id"`, `"$b.rows[*].pass_count"`. Resolved by code before compile. A reference to an unknown or later step, or any other string starting with `$`, is a validation error.

### 4.4 Spec schema and metric registry

```ts
const Spec = z.strictObject({
  metric: Metric,
  entity: z.strictObject({ type: z.enum(["student","section","teacher","room","wing","school"]), id: id | id[] | "$ref" }).optional(),
  filters: z.strictObject({
    destination: oneOrMany(["bathroom","nurse","office","library","counselor","other"]),
    day_of_week: int | int[], period: int | int[],
    ab_day: oneOrMany(["A","B"]), device_type: oneOrMany(["reader","kiosk","handheld"]),
    location: z.string(), issuer: oneOrMany(["tap_out","teacher","handheld"]),
    active_card_type: oneOrMany(["permanent","temp"]), tardy_kind: oneOrMany(["entry","period"]),
    status: oneOrMany(["present","absent","tardy"]),
  }).optional(),
  time_range: z.strictObject({ start: z.string(), end: z.string() }),   // ISO dates, already resolved
  time_point: z.string().optional(),                                    // last_known_location, who_was_where
  group_by: z.array(z.enum(["student","section","teacher","room","wing","period","day_of_week","week","day","hour_bucket","minute_bucket"])).optional(),
  order: z.strictObject({ by: z.string(), dir: z.enum(["asc","desc"]) }).optional(),
  limit: z.number().int().optional(),                                   // default 100, max 500
});
```

Every filter takes one value or a list; the compiler emits `= $n` for one and `= ANY($n)` for several. The allowed values live once in `FILTER_VALUES` (shared), feed the schema, the registry text the planner reads, and the column comments on the views that a tier-3 query reads.

Metric registry (`packages/shared/src/metrics.ts`). Each entry declares its view, expression, allowed group-bys, allowed filters, entity types, and whether it needs a time point.

| Metric | Source view | Definition |
| :---- | :---- | :---- |
| `attendance_rate` | `v_attendance_daily` | Share of scheduled meetings attended (present or tardy). 0 to 1. |
| `present_count` | `v_attendance_daily` | Scheduled meetings marked present or tardy. |
| `absent_count` | `v_attendance_daily` | Scheduled meetings marked absent. |
| `scheduled_count` | `v_attendance_daily` | Scheduled meetings (the denominator of attendance_rate). |
| `tardy_count` | `v_tardies` | Tardies; `tardy_kind` = entry (late to the building) or period (late to class). |
| `override_count` | `v_attendance_daily` | Attendance rows a teacher changed by hand (`source = manual`); `status = absent` counts only overrides to absent. |
| `pass_count` | `v_passes` | Hall passes. |
| `out_minutes` | `v_passes` | Total minutes out of class on passes. |
| `avg_pass_minutes` | `v_passes` | Average pass duration. |
| `entry_count` | `v_entry` | Entrance kiosk taps; `minute_bucket` shows the morning rush. |
| `no_card_entries` | `v_entry` | Entrance events with `result = no_card`. |
| `visits_to_location` | `v_presence` | Arrivals at a location. |
| `students_at_location` | `v_presence` | Distinct students who arrived at a location at least once. |
| `dwell_minutes` | `v_presence` | Minutes from arrival to the next tap elsewhere. Inferred, an upper bound. |
| `last_known_location` | `v_presence` | Each student's last arrival before `time_point`. |
| `who_was_where` | `v_presence` | Students whose last arrival before `time_point` was `location` and who had not tapped elsewhere by then. |
| `temp_id_count` | `v_cards` | Temporary IDs issued in the range. |
| `device_uptime` | `v_device_uptime` | Heartbeats received / expected during school hours. Admin and super_admin only. |
| `device_offline_minutes` | `v_device_uptime` | Minutes with no heartbeat during school hours. Admin and super_admin only. |
| `my_history` | `v_my_history` | Questions the current user asked before, one row per question. Recall, not evidence. |

The planner picks from this enum. It cannot invent a metric. Adding a metric is a registry entry plus a compiler mapping plus a snapshot test.

### 4.5 Tools

| Tool | Signature | Notes |
| :---- | :---- | :---- |
| `lookup_entity` | `(type, text, filters) → {status: resolved | ambiguous | none, match?, candidates}` | Checks the thread's pins first. Otherwise scores `analytics.v_entities` (RLS applies before scoring): exact label 1.0, label starts with the words 0.97, words contained in the label or the label in the words 0.9, else trigram similarity, floor 0.5. Honorifics are stripped for people. For a two-word name, a candidate that scores only by similarity must share the first name (4.5a). `filters` carry grade, period, section_id, teacher_id; sections resolve through the roster view so a teacher sees only her own. |
| `resolve_dates` | `({phrase, kind, unit?, count?, anchor?, month?, year?, start?, end?, weekdays?, clock?}) → {start, end, label, day_of_week?}` | The model fills a typed structure from the words; code does the calendar math from the frozen now against `v_school_days` and returns school days only. `clock = history` resolves against the real clock, for `my_history`. No school day in the range is an error that becomes a clarification. |
| `calc` | `(formula, args) → {value, explanation}` | Named formulas `rate`, `change`, `pct_of`, `avg`, `classes_to_target`, plus a sandboxed `expr` for plain arithmetic (numbers, identifiers, `+ - * /`). An undefined ratio (zero baseline, zero denominator, empty list) is `value: null` with an explanation that names the inputs, not an error; a calc fed a null is null too. `CalcError` is for plan mistakes. |

`run_sql` is not an LLM tool. It is internal to `execute`. Episode retrieval is not a tool either; it runs in code before the planner prompt is built.

### 4.5a Entity resolution contract

Who decides which Bart is Bart. The LLM decides which words are a name and what constraints the sentence carries. Code decides everything after that.

| Lookup returns | Who decides | Result |
| :---- | :---- | :---- |
| One candidate at or above the floor with a clear gap | code | use it |
| Exact label match (1.0) over a prefix match (0.97) | code | use the exact one |
| Pinned in this thread | code | use the pin, no database query |
| Several, and the question carries a constraint ("Bart in my 4th period") | LLM extracts the constraint as a filter; code applies it | usually one left |
| Several within 0.1 of each other, no constraint, no pin | code | `needs_clarification` with chips |
| A two-word name whose only candidates merely resemble it (similarity below 0.9, different first name) | code | `none`: the planner says the person is not available |

No model picks among tied candidates. A clarification chip carries the candidate's id back as `pin` on the next `/api/ask`; the plan node pins it before the planner runs. Pins persist for the thread; naming a different person with the same first name replaces the earlier pin, so "Bart" means the one named last. Two people named in one question both stay pinned.

Two code checks run on the planner's output before anything executes:

1. If any lookup in this run returned `ambiguous` and the planner still emitted a `plan`, the plan is replaced by `needs_clarification` with the tool's candidates as options. The LLM cannot skip the question.
2. Every `entity.id` in every spec must be an id a lookup returned in this run or a pin of this thread (school ids excepted). An id that did not come from a lookup fails validation.

Similarity is `pg_trgm`'s `similarity()`: measured on the seed, "Nelson Muntz" scores 0.500 against "Mia Nelson" and is rejected by the first-name rule; "Bart Simpsen" scores 0.625 against "Bart Simpson" and resolves.

### 4.6 Compiler contract

`compile(spec, persona): { sql, params, shape, caveats }`

- Pure function. Same spec, same SQL, byte for byte. Snapshot-tested for every metric.
- Always parameterized. Never string-interpolates ids or dates.
- Range bounds are cast to the time column's own type (`::date` or `::timestamptz`). A cross-type comparison is not leakproof, and under RLS Postgres evaluates a non-leakproof predicate only after the policy, so it can never use an index; the same-type bound reaches the index (a Gym count went from 2074 ms to 7 ms).
- Always appends `LIMIT` from the spec (max 500).
- Adds the scope predicate from the persona as defense in depth: for a teacher, `section_id IN (own sections)` on section-grained views and `student_id IN (own students)` on student-grained ones; for an admin, `school_id = $n`. RLS remains the guarantee; the predicate keeps the shown SQL honest.
- A filtered count (present, absent, override, no-card, temp) grouped by an entity adds `HAVING <count> > 0`, so "which students did X" lists only students who did; time series and calendars keep their zeros.
- Emits the `shape`: `scalar` (no group), `series` (one time bucket), `categories` (one entity or category), `grouped` (two categories, neither a time bucket), `entity_by_day` (a student's days), `rows` (everything else, and the row metrics).
- Attaches caveats: `inferred_from_next_tap` for `dwell_minutes`, `who_was_where`, `last_known_location`; `scope_limited` for a teacher; `no_wing_group` whenever wing is a dimension (the gym, cafeteria, library, offices and entrances have no wing).
- `my_history` compiles to one row per question with the entity labels aggregated.

### 4.7 Validator contract

`validateSql(sql, {injectLimit}): { ok: true, sql } | { ok: false, reason }`

Runs on every statement, compiled or generated:

1. Parse with `libpg-query`. Parse failure is a rejection. The token stream must contain no comments.
2. Exactly one statement, a `SELECT` (or `WITH ... SELECT`). No `INTO`, no `FOR UPDATE`, no `;` chaining.
3. Every relation referenced is an `analytics.*` view (CTE names excepted). Functions must be in the allowlist: `count, sum, avg, min, max, date_trunc, extract, date_part, coalesce, nullif, round, greatest, least, lead, lag, row_number, rank, dense_rank, percentile_cont, lower, upper, to_char, make_interval, make_time, frozen_now, string_agg`. `current_date` style functions are rejected: "now" is the frozen timestamp.
4. Has a `LIMIT`. Injects `LIMIT 500` if missing on tier-3 SQL; a compiled statement without one is a bug.
5. Outside unit tests: `EXPLAIN` on the scoped connection. Failure is a rejection with the Postgres error attached (goes back to the planner on tier 3).

### 4.8 Critic contract

Input: the question, the resolved entities with their names, per step its definition, SQL, row count, columns, up to 5 sample rows with ids written as "Name (id)", the scalar value, and a facts block code computed over the full result (total where summing is meaningful, the highest and lowest rows, the first and last rows of a time series, the top row per series of a grouped result, how many rows have an empty dimension), and the caveats.

Output: `{ pass: boolean; reason: string; fixes?: string }`.

Rubric in the prompt:

- Does each step's SQL compute what the plan says it computes?
- Does the set of steps answer the question asked, not a nearby one?
- A non-aggregated result with more than 50 rows for a question that asked for a summary fails with "aggregate instead".
- A result that is suspiciously empty where data should exist fails with "check filters"; a zero confirmed by another step in the same plan passes.
- An empty `v_my_history` result is the answer, not suspicious.
- A calc value of null is a defined result with its explanation, not a missing number.
- Any number the answer would rely on that does not come from a step result fails.

The critic sees no planner reasoning and no prior critique, only the artifacts. Row samples and names are data, not instructions.

### 4.9 Presenter and VizSpec

```ts
const VizSpec = z.object({
  type: z.enum(["stat","line","bar","calendar","table"]),
  step: z.string(),                      // the plan step the chart is drawn from; an enum of answer_from per run
  title: z.string(),
  x: { field, label }.optional(), y: { field, label }.optional(),
  series: z.array(z.string()).optional(),
  caveats: z.array(z.string()),
});
```

`type` is derived by code from each candidate step's shape and shown to the presenter: `scalar` → `stat`, `series` → `line`, `categories` and `grouped` → `bar`, `entity_by_day` → `calendar`, `rows` → `table`. The presenter names `viz.step`, may override `type` only within the enum, and fills the title, labels and caveats (copied from state, rewordable, never dropped). Code checks that `x.field` and `y.field` are columns of the chosen step (stat exempt); a miss gets one corrective call, then `VizValidationError`.

Prose rules: describe the shape of the result from the facts (the peak, the low, the trend, the total); every number comes from a step value, the facts or the sample rows; no arithmetic between numbers, with rounding to one decimal and a rate written as a percentage the only allowed rewriting; exactly one visual, named by its type; people and rooms by name; empty dimensions explained from the caveats; the date range stated. Rows are fetched by the frontend from `ops.run_results`, never embedded; `ops.run_output.labels` carries the names for id columns so the chart draws names and the rows keep ids.

### 4.10 Prompt layout and caching

System prompt for `plan`, in this order so the static prefix caches:

1. Rules and worked examples (static).
2. Schema document from the process cache: views, columns, comments, domain notes, worked examples (static per `schema_version`).
3. Metric registry summary with filter values, and the entity types (static). Cache breakpoint here.
4. The frozen now.
5. Up to three episodes retrieved by sketch key, rendered as data ("past plans that worked").
6. Pinned entities, resolved dates, and the user's recent history entities (for "this student").
7. On a replan: the previous attempt's feedback.
8. The last 10 thread turns and the question.

Nothing in any prompt says who is asking or what they may see. A permission message comes from a lookup that finds nothing. `critique` and `present` get smaller prompts. `sketch` gets the metric names and the question, nothing else.

### 4.11 Process cache

Loaded on demand in the worker and kept across warm invocations: the Anthropic client, the checkpointer, and the schema document. Each invocation runs one cheap query in which the database hashes the current view definitions, comments, domain notes and examples into `schema_version`; the document reloads only when the hash changes. No migration bumps anything; the catalog is the source of truth, and the `/schema` page reads the same document.

### 4.12 LLM call wrapper

`packages/agent/src/llm.ts`. Every model call goes through `Llm.callStructured`. Nothing else imports the Anthropic SDK.

- One client, created at module init: `new Anthropic({ timeout: 30_000, maxRetries: 2 })`. The SDK's timeout covers only the wait for response headers, so every round also passes `AbortSignal.timeout(min(90 s, remaining run budget))`, which the SDK keeps attached through the body read. A cut call is `LlmTimeoutError`, retryable.
- Before every round the run budget is checked (`RunBudgetError` when spent).
- `callStructured(schema, system, messages, {model, max_tokens, effort, tools?, formatSchema?})` uses `messages.create` with `output_config.format` from `zodOutputFormat` when a format schema is given (sketch, critique, present) and plain JSON extraction plus a strict Zod parse otherwise (the planner). Tool rounds run through `onToolUse` up to 6 times.
- After each round, in this order: `stop_reason === 'refusal'` → `LlmRefusedError`; `max_tokens` → `LlmTruncatedError`; tokens over `RUN_TOKEN_CAP` → `BudgetExceededError`; unparseable or schema-invalid output → `LlmParseError`. All non-retryable. `RateLimitError`, `InternalServerError`, `APIConnectionError` become `RetryableError`.
- Every round reports one record: node, model, tokens (prompt, completion, cache read), latency, a 500-character excerpt, the error, and the full transcript: the request exactly as sent (model parameters, tool names, system blocks, messages) and the complete response content with the stop reason. The runtime writes it to `ops.llm_calls` without blocking the next round and settles all writes before the run is marked finished.
- The corrective retries live in the nodes (`plan`, `present`), not here.

### 4.13 Budgets

| Variable | Checked where | Effect when exceeded |
| :---- | :---- | :---- |
| `MONTHLY_TOKEN_BUDGET` | `/api/ask`, `sum(prompt + completion)` over `ops.llm_calls` for the UTC month, in-flight runs included | 429 before any run is created |
| `RUN_TOKEN_CAP` | LLM wrapper, after every round; seeded with what earlier attempts of the run spent | `BudgetExceededError`, run fails, visible in `/ops` |
| `RUN_TIME_BUDGET_MS` (240 s) | before every model round and between steps | `RunBudgetError`, run fails |
| `PER_CALL_TIMEOUT_MS` (90 s) | every model round | `LlmTimeoutError`, run requeued |

Defaults: 5,000,000 tokens a month and 150,000 a run; the local `.env` sets the monthly budget to 50,000,000.

---

## 5. Phase 2: Verify the structure (no database)

Vitest, 211 tests, none needs a database or a key.

| Test file | Asserts |
| :---- | :---- |
| `plan-schema.test` | Valid plans and clarifications parse. Unknown metric, unknown filter key, unknown spec field, unknown step kind and an enum miss are rejected by the schema; five steps, a bad ref, a forward ref and an unlooked-up id by `validatePlan`. Sketch parses, rejects an unknown metric, allows empty metrics. |
| `compiler.test` | Snapshot per metric. Determinism. Scope predicate present for a teacher, absent for super_admin, school for admin. Casts to the column type. Filters as one value or a list. Zero groups dropped for filtered counts. Shapes, caveats, limit cap, invalid pairings rejected. |
| `validator.test` | Rejects `DELETE`, `UPDATE`, `SELECT ... INTO`, two statements, `public.*`, `ops.*`, `pg_sleep()`, comments, missing LIMIT on tier 3. Accepts every compiler snapshot. |
| `refs.test` | Every reference form resolves; unknown step, out-of-range index, missing column, bad syntax and missing value fail readably; `resolveRefsDeep`; `referencedSteps`. |
| `calc.test` | Every named formula, zero baselines, unreachable targets, empty lists, the `expr` sandbox. |
| `llm.test` | Fake client returning refusal, truncation, unparseable output, 429, timeout: each produces its typed error. Token cap, including across attempts. The transcript record on success, on failure, and across a tool round. |
| `episodes.test` | Templatize replaces entities by type and dates by `{date_range}`; no name from `resolved` survives; one pass, longest form first. |
| `lookup-entity.test` | Tie logic; honorifics stripped; first-name agreement; pins answer without a query; numeric ids. |
| `facts.test`, `labels.test` | The facts block per shape; the series rule; id columns never taken as the value. Labels resolved per entity type and written as "Name (id)". |
| `heartbeat.test` | Beats on the interval; stops at the budget; stops on a lost lease; a failed write is reported; no stacking. |
| `graph.test` | Happy path visits sketch → plan → execute → critique → present. Sketch failure reaches plan with no episodes. Critic failure replans at most twice then presents uncertain. Ambiguous lookup becomes a clarification even if the planner emitted a plan. One corrective planner call. The presenter's chart step is recorded and checked. Chaos crash after execute resumes on attempt 2 without re-running earlier nodes. Pins persist, replace on a new name, and survive two names in one question. A 500-row result keeps state under 32 KB. |
| `resolve-dates.test`, `viz.test`, `transcript.test` | Calendar math; chart step and type rules; prompt blocks split and expanded. |
| `apps/web` pure modules | Grouped-bar pivot, rate formatting, label lookup, policy text rules, schema document parsing, trace grouping. |

---

## 6. Phase 3: Migrations

Plain SQL in `supabase/migrations/`, 22 files, created with `npm run db:new` and applied with `npm run db:push`. An applied migration is never edited. Every table and column the LLM will see gets a `COMMENT`.

### 6.1 Database roles

| Role | Used by | Grants |
| :---- | :---- | :---- |
| `ask_moov_app` | `/api/ask`, `/api/worker`, checkpointer, memory, `/ops`, `/schema` | `ops.*`, `memory.*`, `langgraph.*` read/write. No access to `analytics`. |
| `ask_moov_query` | `execute`, lookups, labels | `SELECT` on `analytics.*` and, because the views are `security_invoker`, `SELECT` on the `public` base tables filtered by RLS; `teachers.email` revoked at the column level. `statement_timeout = 5s`. `default_transaction_read_only = on`. No access to `ops` beyond `runs` and `run_entities` for history. |

Two pools in the worker. The query pool runs `BEGIN READ ONLY` and `SELECT set_config('app.role', $1, true), set_config('app.user_id', $2, true), set_config('app.school_id', $3, true)` at the start of every transaction. Without those settings every view returns zero rows (tested).

### 6.2 Migration list

- **domain**: `schools`, `school_calendar`, `bell_schedule`, `rooms` (with `wing`, null for the gym, cafeteria, library, offices and entrances), `teachers`, `students`, `cards`, `sections`, `rosters`, `devices`, `passes`, `attendance`, plus the three derived event tables the views read: `presence_events` (one row per arrival with `left_by` and `left_by_kind`), `entry_events` (kiosk taps with `tardy` and `result`), `device_hours` (device × school hour with `online_ratio`, `offline_minutes`). Raw `taps` and `device_heartbeats` are generated by the seed and not stored (dropped 2026-10-23: 329 MB of a 500 MB free-plan quota with no reader left). In production the ingest job that derives tap direction maintains the derived tables. `school_id` is on every fact table so super_admin scope is a real predicate.
- **analytics views**, all `security_invoker`: `v_attendance_daily`, `v_tardies`, `v_passes`, `v_entry`, `v_presence`, `v_section_roster`, `v_cards`, `v_device_uptime`, `v_my_history`, `v_entities`, `v_school_days`. Comments on every view and column; enumerated columns list their values. `analytics.frozen_now()` is security definer and evaluated once per statement. Views over the big derived tables denormalize the lookup columns rather than join small RLS-protected tables (the planner picks a nested loop otherwise).
- **roles and RLS**: nologin roles, grants, the policies in 8.2, history policies on `ops.runs` and `ops.run_entities`.
- **ops**: `runs` (with `pins`), `run_steps`, `run_results`, `run_output` (answer, viz, caveats, steps, plan, labels), `run_entities`, `llm_calls` (metrics, excerpt, and the full `request`, `response`, `stop_reason`, `block_hashes`), `tool_calls`, `prompt_blocks` (large prompt blocks once by sha256), `schema_meta` (frozen now).
- **memory**: `pg_trgm` only. `episodes`, `episode_feedback`, `domain_notes` (14 topics), `schema_examples`.
- **langgraph**: the checkpoint tables, committed as DDL so migrations are the source of truth.
- **cron**: `ops.redispatch()` every minute (2.1 step 10), `ops.retention()` nightly: transcripts after 7 days, rows that can hold names or result rows after 30, thread memory of threads idle for 30 days. `app_url` and `worker_secret` live in Supabase Vault; `npm run db:roles` sets the roles' passwords and both secrets, `npm run db:vault -- <url>` points the cron at a deployment without touching passwords.

Definition of done: `npm run db:push` applies cleanly; 11 views with comments; the query role without `set_config` gets zero rows from every view; `cron.job` shows `redispatch` and `retention`.

---

## 7. Phase 4: Seed

`packages/db/seed/generate.ts`, deterministic, `--seed`, `--scale`, `--no-stories`.

### 7.1 Sizes

Springfield High: 1,500 students, 90 teachers, 80 classrooms plus 8 bathrooms, cafeteria, gym, library, office, 2 entrances, 8 periods, A/B rotation. Shelbyville High: 300 students, same shape. 40 school days ending on the frozen now (8 weeks: the stories need six weeks of drift and eight Tuesdays). Loaded: 127,709 passes, 496,152 attendance rows, 671,813 presence events, 63,525 entry events, 43,665 device hours, 368 MB.

Frozen now: Tuesday, October 13, 2026, 10:40 AM, 3rd period in progress. Everything "live" is computed against this timestamp. Data lives on this frozen timeline; history (`ops.runs`) is stamped by the real clock.

### 7.2 Generation order

Calendar and bells; rooms, wings, kiosks and handhelds; teachers and sections; students, rosters, cards (4% with an active temp); per day per student an entry tap (90%, 8% after the bell, 2% absent all day) and a classroom tap per scheduled section (96% present); passes (22% bathroom tap-outs, log-normal around 6 minutes; 3% teacher-created with a destination tap); attendance from taps with 2% manual-absent-after-tap and 1% manual-present-no-tap; device heartbeats with injected outages; handheld taps in passing time; lunch taps at the cafeteria kiosk and PE sections in the gym. The derived tables are written by the seed in the same pass; the raw tap and heartbeat streams stay in memory.

### 7.3 Planted stories

Each is a rule the generator consults, neutral under `--no-stories`.

| # | Story | Shows |
| :---- | :---- | :---- |
| 1 | Nelson and Jimbo tap out within 3 minutes of each other from different rooms, 6 of the last 8 Tuesdays, 3rd period | co-occurrence |
| 2 | Milhouse's bathroom pass length climbs 5 → 9 → 14 → 19 minutes over 6 weeks, never over 20 | drift under threshold |
| 3 | 6th period produces 3× the tap-outs of any other period, concentrated in the East wing | hot spot by period and wing |
| 4 | Ralph taps the entrance every Friday, then nothing after period 2, 4 of 5 Fridays | in building, not in class |
| 5 | Bart's tardies drop 8 → 4 → 1 over three weeks | positive trend |
| 6 | Room 214's reader is offline 9:50 to 10:20 on October 6 and 8 | data-quality caveat |
| 7 | Lisa has 34 present out of 40 scheduled in Ms. Hoover's section | calc |
| 8 | Martin is on his 4th temp ID this month; his permanent card is deactivated | temp IDs |
| 9 | Ms. Krabappel overrides tap attendance to absent 6 times for Bart in two weeks | teacher contradiction |
| 10 | Entrance 2 has a 7:52 to 7:58 surge every day (bus arrival) | entry by time bucket |
| 11 | Shelbyville's attendance rate is 3 points lower than Springfield's | district comparison |
| 12 | At 10:40 on the frozen day, 31 students are mid-pass; 2 have been out more than 20 minutes | live questions |
| 13 | A Shelbyville course is named with an instruction-like string | prompt injection through data |

### 7.4 Null-data check

`npm run seed -- --no-stories` then `npm run evals -- --label no-stories`. Every "pattern" question must return nothing interesting. Not yet run (it replaces the seed twice); listed as open in `docs/PLAN.md`.

Definition of done: `npm run seed` produces identical row counts and checksums on repeat runs (verified).

---

## 8. Phase 5: Authorization

### 8.1 Roles and scopes

| Role | Sees |
| :---- | :---- |
| `teacher` | Students on their rosters, their own sections, passes and attendance for those sections, presence and entry events for their students. No device data. No other teachers' sections. |
| `admin` | Everything in their `school_id`, including device data. |
| `super_admin` | Everything, all schools. |

Scope is a function of `(role, user_id, school_id)`. Nothing else. The three demo personas are Edna Krabappel (teacher 12), Seymour Skinner (admin, school 1), Gary Chalmers (super_admin). The browser sends a key; `personaFor` maps it to the tuple on the server, which is the one place a login would plug in.

### 8.2 Enforcement

Policies on the `public` tables, evaluated through the `security_invoker` views. Fact tables (`passes`, `attendance`, `presence_events`, `entry_events`, `students`, `rosters`, `cards`) have three policies each: teacher by `analytics.my_section_ids()` or `analytics.my_student_ids()`, admin by `school_id`, super_admin unconditional. Device tables (`devices`, `device_hours`) have admin and super_admin policies only. Dimension tables (`schools`, `school_calendar`, `bell_schedule`, `rooms`, `teachers`, `sections`) are readable within the school by every role and everywhere by super_admin; `teachers.email` is unreadable by the query role at the column level. Thirty-five policies in all; the `/schema` page lists them with what each applies to.

History: the query role has `SELECT` on `ops.runs` and `ops.run_entities` under one policy each, `(persona->>'user_id')::int = current_setting('app.user_id')`. `analytics.v_my_history` is `security_invoker` like every other view, so a user sees only their own past questions, whatever their role.

### 8.3 Why this is not "the agent sees everything and filters"

The `execute` node opens a read-only transaction on the `ask_moov_query` pool and runs `set_config` before any query. Views are `security_invoker`, so RLS on the base tables applies to the view query. If the planner emits a spec for a section the teacher does not teach, the compiler adds the scope predicate, and even if it did not, RLS returns zero rows. Lookups and label resolution go through `v_entities` on the same connection, so a teacher cannot even name a student she does not teach. There is no code path where out-of-scope rows reach the LLM, the result store, or the UI. The planner is never told who is asking; "that student isn't available to you" comes from a lookup that found nothing.

### 8.4 Tests

`npm run test:db`, 24 tests against the real database, no model calls: the query role with no session variables gets zero rows from every view; a teacher sees passes for exactly her sections, zero rows when naming another teacher's section, resolves only her students, sees no device data, sees entry tardies for her students; teacher A cannot see B's attendance, overrides or students, B's email is unreadable for every role, A still sees B's name; an admin sees all of their school and nothing of the other; super_admin sees both schools; the base table yields the same scoped rows as the view, never more; the query role cannot write even inside a transaction; history is per user. Plus the durability, memory, transcript and route tests of 10, 11 and 12.

---

## 9. Phase 6: Observability

### 9.1 Write points

| When | Table | Row |
| :---- | :---- | :---- |
| `/api/ask` | `runs` | insert, `queued`, `git_sha`, `pins` |
| `/api/worker` claim | `runs` | `running`, `attempt`, `claimed_at`, `heartbeat_at` |
| every 30 s while the claim is held | `runs` | `heartbeat_at` (the lease) |
| every node end | `run_steps`, `runs.current_node` | one row per node per attempt with input and output summaries |
| every model round | `llm_calls` | node, model, tokens, cache reads, latency, excerpt, error, and the full request and response; large prompt blocks once in `prompt_blocks` |
| every tool call | `tool_calls` | tool, args, result, duration |
| `execute` step done | `run_results` | columns, row count, rows (capped at 500) |
| graph end | `run_output`, `run_entities` | answer, viz, caveats, SQL per step, plan, labels; one row per resolved entity |
| graph end, critic passed | `episodes` | templated question, plan, metrics, shape, score 1 |
| graph end, replans exhausted | `episodes` | same, score -1 |
| thumbs | `episode_feedback` | vote; `episodes.score` updated in the same transaction |
| graph end | `runs` | `succeeded` or `failed`, latency, tokens, cost, path, uncertain |

Model-round rows are written without blocking the next round and settled before the final status; nothing is printed to stdout.

### 9.2 Pages

- `/ops`: p50 and p95 latency by path (7 days); fail, tier-3, uncertain and replan rates; cost and tokens per day; cache hit ratio and month-to-date tokens; failures by node; last 20 failed runs; top questions; runs in flight with heartbeat age; stale queued count; episode counts, retrieval hit rate, votes; runs by git sha. Every run id links to its detail page.
- `/ops/runs/[id]`: one run top to bottom over `GET /api/runs/[id]/trace`: the run row, the trail, every model round with its request restored to full text and its complete response, the tool calls under the round that asked, the rows per step, the output. Expired transcripts say so.
- `/schema`: the schema document the planner reads, the row-level policies with what each applies to, column-level grants and role settings, all read from the catalog at request time.

### 9.3 Status transport

The UI polls `GET /api/runs/[id]` every second while a run is `queued` or `running`, and stops on `succeeded` or `failed`. The route returns status, `current_node`, attempt, the trail, the stored vote, and on success the answer, chart spec, caveats, SQL per step, labels and rows. No Realtime, no SSE, no websockets.

---

## 10. Phase 7: Durability

- `/api/worker` verifies `x-worker-secret` with a timing-safe comparison before anything else. Its callers are `/api/ask` (the ping), the worker itself after a retryable requeue, and `ops.redispatch()` via pg_net.
- The claim UPDATE is the concurrency lock. The ping and the cron hitting the same run result in one worker.
- The worker returns 202 right after the claim and runs the graph in `after()`, so the caller is not held open and the function stays alive up to `maxDuration = 300`.
- Liveness is a lease: a 30 s timer renews `heartbeat_at` only while `status = 'running'` on the attempt it claimed, stops at the run budget, and stops when the renewal reports the lease lost. Stale-running threshold is 2 minutes; stale-queued is 1 minute; unclaimed for 10 minutes is failed.
- `RetryableError` → `queued`, `attempt + 1`, one self-ping. Any other error → `failed` with the error class in `runs.error`. Three attempts maximum.
- Chaos flag: `runs.persona.chaos = { crash_after: "execute" }` makes the worker throw a retryable error after that node on attempt 1 only, which requeues the run; attempt 2 resumes from the checkpoint. Disabled unless `CHAOS_ENABLED=true`.
- `thread_id` is stable across runs in a conversation; `run_id` is per question. The checkpointer namespace is the thread; a resumed run finds its own partial state by `run_id` in the checkpoint values.

Tests (`durability.dbtest`): a chaos crash after execute requeues the run and attempt 2 finishes with one `run_steps` row per node and the model called once per node; `ops.redispatch()` requeues a stale worker, fails exhausted and unclaimed runs, dispatches what is still queued; a duplicate `run_id` is a no-op; `/api/ask` returns 429 over budget and 400 on a malformed body.

---

## 11. Phase 8: Memory

### 11.1 Thread memory

LangGraph `PostgresSaver` on the `ask_moov_app` pool. Checkpoint after every node and after every step inside `execute`. `messages` trimmed to the last 10 turns before `plan`.

Entity pinning lives here. When a clarification chip is clicked, or a lookup returns a single confident match, the entity is in `state.resolved.entities` for the rest of the thread. "Bart" means the same Bart until the user names a different one; a different person with the same first name replaces the pin. Pins are per thread on purpose. Reopening a thread in the UI loads its runs with their transcripts and keeps its pins. No Redis; the checkpointer is the session store, survives restarts, and is what resume reads from. Thread memory of a thread idle for 30 days is deleted by retention.

### 11.2 Episodic

Episodic memory is the system remembering which plans worked. No vectors, no embeddings, no names.

Written once per run after `present`: `question_templated` (every resolved entity replaced by `{student}`, `{section}`, `{teacher}`, `{room}`, `{school}`, `{wing}`, every date phrase by `{date_range}`, one pass with the longest form first, only people also matched by first name), the final plan, the metrics used, the shape of the step the chart was drawn from, the critique, `schema_version`, `git_sha`, `score = 1`. A run that exhausted replans is written with `score = -1`.

Feedback: thumbs up adds 1, thumbs down subtracts 2, in the same transaction as the feedback row. Retrieval filters `score >= 0`; two thumbs down take an episode out of retrieval (tested).

Retrieval runs in code inside `plan`, keyed by the sketch: `metrics && $sketch_metrics AND shape = $sketch_shape AND role = $role AND score >= 0`, ordered by same schema version, score, recency, limit 3; fewer than 3 are filled by trigram similarity of the templated question (floor 0.3). The planner sees them as data. `EPISODES_ENABLED=false` skips retrieval; writing is never skipped. Measured on the golden set: 90/90 with episodes on against 89/90 off, replans 3% to 2%.

### 11.3 What is deliberately not here

No user-level alias memory. No vectors or embeddings. No learned domain knowledge: `domain_notes` is written by us, loaded into the prompt, and changes only by migration. History (14.1) is not memory; it is recall of what a user asked, served through a view like any other data. Two tiers only: the conversation remembers itself, the system remembers what worked.

---

## 12. Phase 9: Evals

`packages/evals/golden/*.json`, one file per persona, 30 cases each, 90 in all. Every numeric expectation was computed by SQL against the seed as the asking persona before the case was written.

```json
{ "id": "admin-room-214-offline", "persona": "admin",
  "question": "How many minutes was the Room 214 reader offline on October 6?",
  "expect": { "kind": "plan", "metrics": ["device_offline_minutes"], "viz_type": "stat", "result": { "value_is": 30 } } }
```

Assertions: `kind`, `reason`, `options_min`, `metrics`, `steps_min`, `viz_type`, `viz_metric` (the chart must be drawn from the step with that metric), `path`, `caveats_include`, `result` (`formula`, `value_is`, `value_min`, `value_between`, `row_count_min`, `row_count_between`), `no_out_of_scope_rows` (every row of a teacher's run is checked against her rosters), `no_public_sql`.

The runner invokes the shared runtime directly, twice: with `EPISODES_ENABLED=false`, then on with the episodes the first pass wrote. `report.md` has one table per pass and a delta row, reported as measured; a `--only` run writes `report-only.md` and never overwrites it. A case whose runtime throws is one failed row, not the end of the suite. Latest full run (2026-10-24): 89/90 off, 90/90 on, the one miss fixed in the compiler. Coverage: every out-of-scope reason, tier 3, three history shapes, three injection cases, every registry metric at least once.

---

## 13. Phase 10: Frontend

1. Persona switcher: three personas as native radios, each a real `(role, user_id, school_id)` on the server. Switching starts a new thread.
2. Thread list from `ops.runs` grouped by thread (eval threads hidden), with a loading state; reopening loads the thread's runs and transcripts.
3. Chat with the run trail on every card (Read, Plan, Run, Check, Write, with durations, replans numbered) and a status line while running.
4. Answer card: `answer_md` through react-markdown with raw HTML off and images and links removed; the chart drawn from `viz.step` with names for id columns; caveats; collapsible SQL and params per step; thumbs that persist; a Trace link.
5. Clarification chips: clicking one re-asks the card's question with the chosen entity carried by id.
6. `VizRenderer`: stat (rates as percentages), line, bar, grouped bar (series by the same rule as the backend facts, a grey "No wing" series), calendar heatmap, table (null as an em dash).
7. "What can I ask?" example chips per persona.
8. `/ops`, `/ops/runs/[id]`, `/schema` as in 9.2. Header links to Operations and Schema.
9. Responsive: a drawer on phones, verified at 390, 768 and 1360 px in light and dark.

No auth by decision: one person switches persona.

---

## 14. Question catalog

### 14.1 Answerable shapes

| Shape | Example | Path |
| :---- | :---- | :---- |
| Lookup | Where did Bart last tap in? | spec: `last_known_location` with `time_point = now` |
| Aggregate | Attendance rate in my 4th period this month | spec: `attendance_rate` |
| Ranking | Top 10 students by out-minutes this week | spec: `out_minutes`, group by student, order desc, limit 10 |
| Trend | Tardies week over week since September | spec: `tardy_count`, group by week |
| Comparison | Springfield vs Shelbyville attendance | two specs plus a `calc` (the compiler has no school dimension) |
| Breakdown | Bathroom passes by period and wing | spec with two group-bys → grouped bar |
| Co-occurrence | Who is out at the same time as Nelson most often? | tier 3 (self-join on `v_passes`) |
| Projection | How many more classes does Lisa need to hit 98%? | spec + `calc classes_to_target` |
| Calendar | Show me Ralph's attendance this month | spec: `present_count` group by day → calendar |
| Live | Who is in the Gym right now? | spec: `who_was_where` |
| Data quality | Was the Room 214 reader online on October 6? | spec: `device_uptime` or `device_offline_minutes` |
| Departure | Who has left the building? | inferred from the absence of later taps, labeled inferred |
| History | What did I ask about this student? | spec: `my_history`; "this student" with no name → clarification built from `v_my_history` |

A trend question with no date phrase spans the school year; any other question with no date phrase is this month, and the answer says which.

### 14.2 Out of scope, by reason

| Reason | Example | Response |
| :---- | :---- | :---- |
| `not_in_data` | What are Bart's grades? | "I only have tap, pass, attendance and device data. I can show you his attendance or tardies." |
| `identity` | Is Bart sharing his card? | "Taps show where a card was, not who held it. I can show you Bart's overlapping passes with other students." |
| `action` | Set a buddy block for Nelson and Jimbo | "I can't change settings. Here's the overlap data to bring to an admin." |
| `permission` | (teacher) How many passes did Nelson Muntz take? | "Nelson Muntz isn't available to you." (the lookup found nothing) |
| `advice_or_prediction` | What should I do about Nelson? | "That's a judgment call. Here's his pass history for the last month." |
| `needs_clarification` | How many passes did Bart take? (two Barts) | "Which Bart?" with chips. Also vague metrics ("how is Bart doing?"), unresolvable dates, and "this student" with no name. |

---

## 15. Domain notes (seed content for `memory.domain_notes`)

Fourteen topics: `taps`, `exit_taps`, `kiosk_location`, `one_active_card`, `bathroom`, `attendance`, `tardy`, `manual`, `devices`, `scope`, `ab_day`, `now`, `history` (history rows are stamped with the real clock and resolved with `clock = history`), `timezone`. The text is in the memory migration; the `/schema` page shows it as the planner sees it.

---

## 16. Non-goals for v1

- Authentication. Personas are chosen, not logged in; `personaFor` is where a session would map to a persona.
- Writes of any kind to domain data.
- Multi-tenant beyond two seeded schools.
- Real SIS integration; a live ingest job for the derived tables.
- Streaming tokens. Status is polled; the answer arrives whole.
- Realtime, websockets, server-sent events, Database Webhooks.
- Vector search or embeddings of any kind.
- Learned domain knowledge.
- Alerting, an external log sink, rate limiting beyond the monthly budget.

---

## 17. Environment and commands

```
DATABASE_URL_ADMIN=            # postgres, migrations, seed, role setup; never on Vercel
DATABASE_URL_APP=              # ask_moov_app; on Vercel the IPv4 pooler host in transaction mode (port 6543)
DATABASE_URL_QUERY=            # ask_moov_query; same
ANTHROPIC_API_KEY=
APP_URL=                       # public base URL; /api/ask pings APP_URL/api/worker; Vault holds the deployment's copy for the cron
WORKER_SECRET=                 # x-worker-secret; also in Vault
MONTHLY_TOKEN_BUDGET=5000000
RUN_TOKEN_CAP=150000
EPISODES_ENABLED=true
CHAOS_ENABLED=false
VERCEL_GIT_COMMIT_SHA=         # set by Vercel; locally git rev-parse HEAD
```

```
npm run dev                    next dev on :3100
npm test                       unit tests, no database, no key
npm run test:db                authorization, durability, memory, transcript and route tests, real database
npm run typecheck              every package, the app, and the app's test files
npm run lint                   eslint for the app
npm run build                  production build
npm run db:new -- <name>       new migration
npm run db:push                apply pending migrations
npm run db:roles               role passwords to .env, Vault secrets
npm run db:vault -- <url>      point the cron at a deployment
npm run seed                   deterministic seed with stories; -- --no-stories for the null-data baseline
npm run evals                  golden set twice, writes packages/evals/report.md; -- --only <prefix> writes report-only.md
```

---

## 18. Definition of done, overall

- A teacher persona asks about a student not on their roster and gets a scope message; the database returned nothing, and `rls.dbtest` proves it. **Done.**
- A run with `crash_after = execute` finishes on attempt 2 without re-running `sketch`, `plan` or `execute`. **Done, tested.**
- A run whose worker died is picked up by `ops.redispatch()` within one minute, with no webhook configured anywhere. **Done, verified on the deployment.**
- `/ops` shows p95 latency, tier-3 rate, critic fail rate, month-to-date tokens, and episode stats from real runs. **Done.**
- Golden evals pass on seeded data with both passes and the delta as measured. **Done: 89/90 and 90/90.** The null-data pass is not yet run.
- A user can reopen a past thread and ask what they asked about a student; "this student" with no name yields a clarification from their own history. **Done.**
- No table in `memory` contains a student name or a result row. **By construction; see 11.2.**
- Every answer shows its SQL and its caveats, and every model round of every run can be read back in full. **Done.**
- README has a section titled "What tap data can and cannot tell you." **Done.**

---

## 19. Changes in v1.1 (October 18, 2026)

1. Transport and infrastructure: removed Database Webhooks, Realtime, pgvector, embeddings and the prompt hash. Added the worker ping, `ops.redispatch()` on pg_cron, UI polling, `MONTHLY_TOKEN_BUDGET` and `RUN_TOKEN_CAP`, `git_sha` on every run and model call, the LLM wrapper, and markdown rendering with raw HTML off.
2. `memory.semantic_notes` renamed to `memory.domain_notes`. Nothing is called "semantic memory".
3. Episodic memory without vectors: a `sketch` node whose output is only the retrieval key, retrieval by metric overlap and shape with trigram fill, scoring rules, a two-pass eval report.
4. History: `ops.run_entities`, `analytics.v_my_history`, the `my_history` metric, clarification from history for "this student", a thread list.
5. The entity resolution contract in 4.5a.

---

## 20. Changes in v1.2 (October 24, 2026)

Everything below is built, tested and deployed; the session logs carry the evidence for each line.

1. **Run control.** The run budget is 240 s, not 60, checked before every model round and between steps. Every model call has a 90 s deadline that covers the response body (the SDK timeout covers only the headers). Liveness is a 30 s lease-renewal timer beside the run, fenced to the claimed attempt, stopped at the budget and on a lost lease; `current_node` is written per node for the UI only. `ops.redispatch()` fails a run nobody claims in 10 minutes. The per-run token cap spans attempts. A chaos crash is a retryable requeue, so resume is exercised through the real queue path.
2. **The planner answers in plain JSON**, parsed strictly in code with one corrective call; its nested schema exceeds the compiled-grammar limit. Structured outputs stay on sketch, critique and present. All planner-facing objects are strict; filters take one value or a list. Calc args are a list.
3. **Registry and shapes.** `scheduled_count` and `students_at_location` added (20 metrics); `minute_bucket` grouping; shape `grouped` for two categories (a grouped bar); caveat `no_wing_group`; a trend question with no date phrase spans the school year.
4. **Compiler.** Range bounds cast to the column's own type so RLS queries use their indexes; `HAVING > 0` on filtered counts grouped by an entity; `my_history` as one row per question; `v_section_roster` is not a compile target.
5. **Entity resolution.** Honorifics stripped; first-name agreement for two-word names; chips carry the chosen id (`/api/ask` `pin`, `ops.runs.pins`); a new name with the same first name replaces the pin; sections resolve through the roster view.
6. **Dates and clocks.** `resolve_dates` takes a typed structure and `clock = history` for history questions, which live on the real clock while data lives on the frozen timeline.
7. **The critic and the presenter see facts, not just samples.** Per step: up to 5 sample rows with ids as "Name (id)", a facts block code computes over the full result, and the plan's resolved entities. The presenter names the chart step (`viz.step`), code checks the chart is drawable from it, the prose quotes numbers only from steps, facts or samples and never derives one, and names exactly one visual. Names for id columns are stored as `run_output.labels`.
8. **Calc semantics.** An undefined ratio or an empty list is `value: null` with an explanation, not an error; `change(0, 0)` is 0.
9. **Memory.** Templatize is one pass, longest form first, people only by first name. Thread memory of idle threads expires after 30 days. The stored vote is served with the run view.
10. **Observability.** Every model round stores its full request (system blocks, messages, model parameters) and response; blocks over 2 KB once by content hash in `ops.prompt_blocks`; written without blocking the next round and settled before the run is marked finished; transcripts expire after 7 days, metrics stay. `GET /api/runs/[id]/trace` and `/ops/runs/[id]`. `/schema` reads views, policies and grants from the catalog. The monthly budget counts `ops.llm_calls` for the UTC month.
11. **Data.** Raw `taps` and `device_heartbeats` are not stored; the views read `presence_events`, `entry_events` and `device_hours`, denormalized rather than joined to small RLS-protected tables. 40 school days. Story 13, the injection-named course. Enumerated columns carry their values as comments.
12. **Prompt injection.** The renderer disallows images, links and raw HTML; episode text and tool results are delimited as data; three injection cases in the golden set; the `/ops` and trace pages are open by decision.
13. **Evals.** 90 cases, 30 per persona, every number computed from the seed as the asking persona; `viz_metric` and `caveats_include` assertions; a `--only` run never overwrites `report.md`; a runtime error is one failed row. Latest: 89/90 off, 90/90 on.
14. **Frontend.** Rebuilt as modular components, responsive, grouped bars, names on charts and in tables, rates as percentages, em dash for null, persistent votes, thread reopening with transcripts, Operations and Schema links, `/schema`, `/ops/runs/[id]`, Trace links.
15. **Deployment.** GitHub `Shoyo-Hin4ta/askMoov`, Vercel project `ask-moov` (Hobby, Fluid compute, root `apps/web`), Supabase pooler hosts in transaction mode, port 6543 (the direct host is IPv6-only; the session pooler on 5432 gives each open socket one of a role's 15 slots, which four simultaneous questions exhausted on 2026-10-25), Vault `app_url` set by `npm run db:vault`. The cron re-dispatch was verified against the deployment.
16. **Tests.** 211 unit, 24 database. Test files are excluded from the app's build-time type check and typed by `apps/web/tsconfig.test.json`.
