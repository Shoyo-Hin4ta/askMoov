# Ask MOOV: Design and Build Plan

Status: v1.1, October 18, 2026\. Owner: Ritik. Audience: Claude Code and anyone reviewing the repo. Changes from v1 are listed in section 19.

---

## 0\. What this is

Ask MOOV is a production-grade analytics agent over school tap data in the shape MOOV (joinmoov.com) collects: ID card taps on classroom readers, entry kiosks and staff handhelds, plus the hall passes and attendance derived from those taps. A teacher, building admin or district admin asks a question in plain English and gets an answer, a chart, and the SQL that produced it, scoped to exactly the data their role is allowed to see.

It runs on synthetic data for a fictional school (Springfield High, plus a small second school so district scope means something). The agent is the product. The data is the stage.

What it is not: a MOOV clone, a dashboard, a RAG system, a multi-agent system, a demo that runs inline in a request handler.

---

## 1\. Principles (non-negotiable)

1. **LLM decides content, code decides control.** The graph is fixed. The LLM fills in a plan. Code runs it. The LLM never picks the next node.  
2. **Data scope is enforced in Postgres, never in a prompt.** The query connection runs with the caller's role and user id set as session variables, and row-level security does the rest. The agent physically cannot read rows outside scope. Scope hints in the prompt are a courtesy, not a gate.  
3. **The LLM never does arithmetic.** Anything over rows is SQL. Anything over a few scalars is the `calc` tool.  
4. **The LLM never writes SQL unless it has to.** Known question shapes compile from a structured spec. Free-form SQL (tier 3\) is the escape hatch, and it is parsed, allowlisted, and EXPLAINed before it runs.  
5. **Schema knowledge comes from migrations.** Views plus `COMMENT ON` plus a small notes table, introspected at worker start. No hand-maintained schema doc.  
6. **Every run is resumable and every step is recorded.** LangGraph checkpoints after every node. `runs`, `run_steps`, `llm_calls`, `tool_calls` in Postgres are the trace.  
7. **The agent says what it measured and what it inferred.** Reader offline during the window, dwell time inferred from the next tap, scope-limited results. These are first-class caveats, not footnotes.

---

## 2\. Architecture
```
┌──────── Next.js on Vercel ─────────────────────────┐
│ Chat UI · persona switch · thread list · /ops      │
│ VizRenderer (VizSpec → Recharts)                   │
│ POST /api/ask       → budget check, insert run,    │
│                       ping worker, return 202      │
│ POST /api/worker    → claim run, return 202,       │
│                       run graph after response     │
│                       (maxDuration 300)            │
│ GET  /api/runs/[id] → status, steps, result        │
│                       (UI polls every 1s)          │
└──────────┬───────────────────▲─────────────────────┘
           │ pg                │ HTTPS via pg_net
           ▼                   │
┌──────── Supabase Postgres ─────────────────────────┐
│ public:    domain tables (12)                      │
│ analytics: views (9), security_invoker, RLS        │
│ ops:       runs, run_steps, run_results,           │
│            run_entities, llm_calls, tool_calls,    │
│            schema_meta                             │
│ memory:    episodes, episode_feedback,             │
│            domain_notes, schema_examples           │
│ langgraph: checkpoints                             │
│ pg_cron:   every minute, re-dispatch runs queued   │
│            > 1 min or running with heartbeat       │
│            > 2 min by POSTing /api/worker          │
└────────────────────────────────────────────────────┘
```

### 2.1 Request lifecycle
1. UI posts `{run_id, thread_id, persona, question}` to `/api/ask`. `run_id` is a client-generated UUID and the idempotency key.
2. `/api/ask` checks the monthly token budget: `sum(total_tokens)` over `ops.runs` for the current calendar month against `MONTHLY_TOKEN_BUDGET`. Over budget returns 429 with the numbers. Otherwise it inserts `ops.runs` with `status = 'queued'`, `queued_at = now()`, and `git_sha`. Duplicate `run_id` is a no-op (`ON CONFLICT DO NOTHING`).
3. `/api/ask` POSTs `{run_id}` to `/api/worker` with the `x-worker-secret` header (the ping). It waits only for the worker's 202, not for the run, then returns 202 to the UI.
4. `/api/worker` verifies the secret, then claims the run: `UPDATE ops.runs SET status='running', claimed_at=now(), heartbeat_at=now(), attempt=attempt+1 WHERE id=$1 AND status='queued' RETURNING *`. No row returned means another invocation has it; return 200 and exit. Otherwise return 202 immediately and run the graph in Next.js's post-response hook (`after()` from `next/server`), which keeps the function alive up to `maxDuration`.
5. The graph runs with `thread_id`. If a checkpoint exists for this thread and run, execution resumes at the last incomplete node.
6. After each node: write a `run_steps` row, update `runs.current_node` and `runs.heartbeat_at`.
7. The UI polls `GET /api/runs/[id]` every second while status is `queued` or `running`. The route reads `ops.runs` and `ops.run_steps`, and once succeeded, `run_results` and the answer. The browser never holds a Supabase key.
8. On success: write `run_results`, write `run_entities` from `state.resolved`, write an episode if the critic passed, set `status='succeeded'`.
9. On error: `status='failed'` if the error is non-retryable (refusal, truncation, budget, validation exhausted) or `attempt >= 3`. Otherwise `status='queued'`, `queued_at=now()`, and the worker pings itself once.
10. pg_cron every minute calls `ops.redispatch()`: stale running runs (`heartbeat_at < now() - interval '2 minutes'`) go back to `queued` if `attempt < 3`, else `failed`; then every run with `status='queued' AND queued_at < now() - interval '1 minute'` is POSTed to `/api/worker` through pg_net. This is the guarantee. The ping in step 3 is only the fast path.
11. UI renders answer, VizSpec, caveats, and the SQL for each step.

### 2.2 Stack
| Layer | Choice | Why |
| :---- | :---- | :---- |
| Web + API | Next.js 15, App Router, Vercel, Fluid compute | Already the stack. 300s function cap is plenty for 3 to 4 LLM calls. |
| Status transport | UI polls `GET /api/runs/[id]` every second | No Realtime, no websockets, no Supabase key in the browser. One route, one query. |
| Agent runtime | LangGraph.js + `@langchain/langgraph-checkpoint-postgres` | Checkpointing per node for free. |
| LLM | `@anthropic-ai/sdk`, structured outputs via Zod. `claude-opus-5-5` for plan, critique, present. `claude-haiku-5-5` for sketch. | Prompt caching on the schema prefix. SDK retries and typed errors behind one wrapper (4.12). |
| Database | Supabase Postgres, pg_trgm, pg_cron, pg_net | One database for domain, ops, memory, checkpoints, queue. No vector extension. |
| SQL safety | `libpg-query` (Node bindings for the Postgres parser) | Real parser, not regex. |
| Charts | Recharts behind a `VizRenderer` | LLM never sees the library. |
| Tests | Vitest | Unit, compiler snapshots, golden evals. |
| Package manager | npm workspaces | Already installed. No extra tooling. |

### 2.3 Repo layout

apps/web                 Next.js app: UI, /api/ask, /api/worker, /ops

packages/agent           graph, nodes, tools, compiler, validator, prompts, process cache

packages/db              migrations (SQL), seed generator, generated types, db clients

packages/shared          Zod schemas: Plan, Spec, VizSpec, Persona; metric registry

packages/evals           golden set \+ runner

---

## 3\. Phase ordering and dependencies
| Phase | Deliverable | Depends on |
| :---- | :---- | :---- |
| 1 | Agentic structure: graph (with `sketch`), state, schemas, tools, compiler, validator, prompts, LLM wrapper | nothing |
| 2 | Verify structure: unit tests, no database | 1 |
| 3 | Migrations: domain, analytics views (with `v_my_history`), roles, RLS, ops (with `run_entities`), memory, checkpoints, cron | nothing (parallelizable with 1) |
| 4 | Seed: deterministic generator with planted stories | 3 |
| 5 | Authorization: RLS policies live, persona context, scope tests, history scope test | 3, 4 |
| 6 | Observability: ops tables wired, `/ops` queries | 1, 3 |
| 7 | Durability: `/api/ask` with budget check, `/api/worker`, worker ping, re-dispatch cron, chaos flag | 1, 3, 6 |
| 8 | Memory: checkpointer, entity pinning, episodes with sketch-keyed retrieval, feedback votes | 3, 7 |
| 9 | Evals: golden set, runner (episodes off and on), CI | 4, 7, 8 |
| 10 | Frontend: chat, persona switch, thread list, VizRenderer, SQL reveal, thumbs, `/ops` page | everything |

Phase 2 can run without a database because the compiler emits SQL strings and the validator only needs the parser. EXPLAIN is skipped under unit tests. End-to-end verification happens in Phase 9.

The History shape (14.1) is spread across phases: the `my_history` metric and compiler case in 1, `ops.run_entities` and `analytics.v_my_history` in 3, its RLS policy in 5, the thread list in 10.

---

## 4\. Phase 1: Agentic structure

### 4.1 Graph
```
sketch → plan → execute → critique → present
          ▲       │          │
          └───────┴──────────┘   (replan, max 2)
```

Six nodes. `intake` is folded into `plan` as pre-processing. `classify` is folded into `plan` as an output variant.

| Node | LLM? | Does |
| :---- | :---- | :---- |
| `sketch` | yes, `claude-haiku-5-5` | Given the question and the metric names only: `{metrics: Metric[], entity_types: string[], shape}`. Used solely as the episode retrieval key (11.2). Never sees the schema doc. Fails open: on any error `plan` runs with no episodes. |
| `plan` | yes | Load persona and schema doc from cache, resolve entities and dates via tools, retrieve up to 3 episodes by sketch key (code, not a tool), emit `Plan` or `OutOfScope`. Then run the two post-planner code checks (4.5a) plus ref and metric validation. On a schema-valid but invalid plan, make one corrective call with the error attached. |
| `execute` | tier 3 only | Loop over `plan.steps` in order. For each: resolve `$refs`, compile (spec) or accept (sql), validate, run with scoped connection, store result. Collect caveats. Checkpoint after each step. |
| `critique` | yes | Given question, plan, per-step SQL and result summaries: `{pass, reason}`. Separate prompt. Does not see planner reasoning. |
| `present` | yes | Given question, result summaries, caveats, VizSpec schema: `{answer_md, viz}`. |
| `fail` | no | Terminal. Writes reason to `runs.error`. |

Edges:

- `sketch` → `plan` always. Replans return to `plan`, never to `sketch`.
- `plan` → `present` if `OutOfScope` (present renders the message; for `needs_clarification` it also renders `options` as chips, and the run ends there).
- `plan` → `execute` otherwise.
- `execute` → `critique` on success. `execute` → `plan` with error context if a step fails validation or SQL after its own retries (tier 3 only, `retries.sql < 2`). `execute` → `fail` otherwise.
- `critique` → `present` on pass. `critique` → `plan` with critique attached if `retries.plan < 2`. `critique` → `present` with `uncertain = true` otherwise.

Hard limits: 4 steps per plan, 2 replans, 2 SQL regenerations per step, 1 corrective planner call per plan attempt, 60s total budget, 5s statement timeout per query, `RUN_TOKEN_CAP` tokens per run (4.13).

### 4.2 State

type State \= {

  run\_id: string;

  thread\_id: string;

  persona: Persona;                       // { role, user\_id, school\_id, scope\_summary }

  messages: Message\[\];                    // last N turns, trimmed

  question: string;

  resolved: { entities: ResolvedEntity\[\]; dates: ResolvedDates };

  sketch: Sketch | null;                  // { metrics, entity_types, shape } from the sketch node; retrieval key only

  episodes: EpisodeRef\[\];                 // ids \+ templated question \+ plan, not full text

  plan: Plan | OutOfScope | null;

  steps: Record\<string, StepResult\>;      // { status, sql?, value?, rows\_ref?, row\_count?, columns?, error? }

  caveats: Caveat\[\];                      // { kind, text, step\_id? }

  critique: { pass: boolean; reason: string } | null;

  viz: VizSpec | null;

  answer: string | null;

  uncertain: boolean;

  retries: { plan: number; sql: number };

  schema\_version: string;

  git\_sha: string;                        // VERCEL_GIT_COMMIT_SHA, or git rev-parse HEAD locally

};

Not in state: the schema doc, full result rows, raw episode text. Rows go to `ops.run_results` keyed by `run_id` and `step_id`. Schema lives in the process cache.

### 4.3 Plan schema

const Step \= z.discriminatedUnion("kind", \[

  z.object({ id: z.string(), kind: z.literal("spec"), spec: Spec }),

  z.object({ id: z.string(), kind: z.literal("calc"), formula: z.string(), args: z.record(z.union(\[z.number(), z.string()\])) }), // string \= "\$stepId.path"

  z.object({ id: z.string(), kind: z.literal("sql"), sql: z.string(), reason: z.string() }), // tier 3

\]);

const Plan \= z.object({

  kind: z.literal("plan"),

  steps: z.array(Step).min(1).max(4),

  answer\_from: z.array(z.string()),

  expected\_shape: z.enum(\["scalar","series","categories","entity\_by\_day","rows"\]),

});

const OutOfScope \= z.object({

  kind: z.literal("out\_of\_scope"),

  reason: z.enum(\["not\_in\_data","identity","action","permission","advice\_or\_prediction","needs\_clarification"\]),

  message: z.string(),

  suggestion: z.string().optional(),

  options: z.array(z.object({                       // needs\_clarification only

    label: z.string(),                              // "Bart Simpson, 9th, your 4th period"

    entity: z.object({ type: z.string(), id: z.union(\[z.number(), z.string()\]) }).optional(),

  })).max(5).optional(),

});

References: `"$a.value"`, `"$a.rows[0].student_id"`, `"$b.rows[*].pass_count"`. Resolved by code before compile. Unknown ref is a validation error.

### 4.4 Spec schema and metric registry

const Spec \= z.object({

  metric: Metric,                                  // enum below

  entity: z.object({ type: z.enum(\["student","section","teacher","room","wing","school"\]), id: z.union(\[z.number(), z.string()\]) }).optional(),

  filters: z.object({

    destination: z.enum(\["bathroom","nurse","office","library","counselor","other"\]).optional(),

    day\_of\_week: z.array(z.number().min(1).max(5)).optional(),

    period: z.array(z.number()).optional(),

    ab\_day: z.enum(\["A","B"\]).optional(),

    device\_type: z.enum(\["reader","kiosk","handheld"\]).optional(),

    location: z.string().optional(),               // room or zone name, resolved

    issuer: z.enum(\["tap\_out","teacher","handheld"\]).optional(),

    active\_card\_type: z.enum(\["permanent","temp"\]).optional(),

  }).default({}),

  time\_range: z.object({ start: z.string(), end: z.string() }),  // ISO dates, already resolved

  time\_point: z.string().optional(),               // for last\_known\_location, who\_was\_where

  group\_by: z.array(z.enum(\["student","section","teacher","room","wing","period","day\_of\_week","week","day","hour\_bucket"\])).default(\[\]),

  aggregate: z.enum(\["sum","avg","count","min","max","avg\_per\_student"\]).optional(),

  order: z.object({ by: z.string(), dir: z.enum(\["asc","desc"\]) }).optional(),

  limit: z.number().max(500).default(100),

});

Metric registry (`packages/shared/metrics.ts`). Each entry declares its source view, the expression, allowed group\_bys, allowed filters, and the result shape it produces.

| Metric | Source view | Definition |
| :---- | :---- | :---- |
| `attendance_rate` | `v_attendance_daily` | present / scheduled meetings |
| `present_count` | `v_attendance_daily` | count of present |
| `absent_count` | `v_attendance_daily` | count of absent |
| `tardy_count` | `v_tardies` | entry tardies \+ period tardies, filterable by type |
| `override_count` | `v_attendance_daily` | count where source \= manual |
| `pass_count` | `v_passes` | count of passes |
| `out_minutes` | `v_passes` | sum of pass duration |
| `avg_pass_minutes` | `v_passes` | avg of pass duration |
| `entry_count` | `v_entry` | kiosk taps at entrance zone |
| `no_card_entries` | `v_entry` | entries with result \= no\_card |
| `visits_to_location` | `v_presence` | count of arrivals at a location |
| `dwell_minutes` | `v_presence` | arrived\_at to left\_by, flagged inferred |
| `last_known_location` | `v_presence` | last arrival before `time_point` |
| `who_was_where` | `v_presence` | students whose last arrival before `time_point` was `location` and whose next tap is after it |
| `temp_id_count` | `v_cards` | temp IDs issued to a student in the range |
| `device_uptime` | `v_device_uptime` | online heartbeats / expected heartbeats |
| `device_offline_minutes` | `v_device_uptime` | sum of offline gaps in school hours |
| `my_history` | `v_my_history` | past questions by the current user, filterable by `entity` and `time_range`; recall, not student evidence |

The planner picks from this enum. It cannot invent a metric. Adding a metric is a registry entry plus a compiler case plus a test.

### 4.5 Tools
| Tool | Signature | Notes |
| :---- | :---- | :---- |
| `lookup_entity` | `(type, text, filters?) → {id, label, detail, confidence}[]` | Checks `state.resolved.entities` first; a name already pinned in this thread resolves to the pinned id. Otherwise pg_trgm fuzzy match over students, teachers, sections, rooms, zones, scope-aware (a teacher only resolves students on their rosters). If the top two are within 0.1 confidence, planner must emit `needs_clarification` with `options`; `detail` carries what distinguishes them (grade, section, student id). An explicit different name ("Bart Reyes") overwrites the pin. |
| `resolve_dates` | `(text, today, calendar) → {start, end, label}` | "last week", "this marking period", "Tuesdays in September", "today". Uses `school_calendar`. Returns school days only. |
| `calc` | `(formula, args) → {value, explanation}` | Named formulas: `rate(num, den)`, `change(before, after)`, `classes_to_target(attended, scheduled, target)` (returns `unreachable` when target > 1), `pct_of(part, whole)`, `avg(values[])`, plus a sandboxed `expr` mode for plain arithmetic. No I/O. |

`run_sql` is not an LLM tool. It is internal to `execute`.

Episode retrieval is not an LLM tool either. It runs in code before the planner prompt is built, keyed by the `sketch` output (11.2). The planner sees the result as text in its prompt and cannot ask for more.

### 4.5a Entity resolution contract

Who decides which Bart is Bart. The LLM decides which words are a name and what constraints the sentence carries. Code decides everything after that.

| Lookup returns | Who decides | Result |
| :---- | :---- | :---- |
| One match above threshold | code | use it |
| Exact name match (similarity ≥ 0.95) | code | use it, even if other same-first-name students exist |
| Pinned in this thread | code | use the pin |
| Several, and the question carries a constraint ("Bart in my 4th period", "Bart the freshman") | LLM extracts the constraint as a filter; code applies it | usually one left, use it |
| Several, no constraint, no pin | code | `needs_clarification` with chips |

No model picks among tied candidates. A tie means there is no information left to decide with, so the system asks. One click on a chip is cheaper than one wrong student.

`lookup_entity` accepts optional filters: `grade`, `section_id`, `teacher_id`, `period`. The planner fills them from the question. Scope is applied before scoring, so a teacher with one Bart on their rosters never sees a tie.

Two code checks run on the planner's output before anything executes:

1. If any lookup in this run returned `ambiguous` and the planner still emitted a `plan`, the plan is rejected and `needs_clarification` is emitted with the tool's options directly. The LLM cannot skip the question.  
2. Every `entity.id` in every spec must be an id returned by a lookup in this run (or a pin). An id that did not come from a lookup fails validation.

Similarity is `pg_trgm`'s `similarity()`: the share of three-character chunks two strings share, 0 to 1\. It is a number and a threshold, not a judgment.

### 4.6 Compiler contract

`compile(spec: Spec, persona: Persona): { sql: string; params: unknown[]; shape: Shape }`

- Pure function. Same spec, same SQL, every time. Snapshot-tested.  
- Always parameterized. Never string-interpolates ids or dates.  
- Always appends `LIMIT` from spec (max 500).  
- Adds the scope predicate from persona as defense in depth (`AND section_id = ANY($scope)` for teachers). RLS remains the guarantee; this just keeps the SQL honest when shown to the user.  
- Emits the `shape` the result will have, so `present` knows the viz type before the LLM sees anything.  
- For `dwell_minutes`, `who_was_where`, `last_known_location`: attaches a caveat `inferred_from_next_tap`.

### 4.7 Validator contract

`validate(sql: string): { ok: true } | { ok: false; reason: string }`

Runs on every statement, compiled or generated:

1. Parse with `libpg-query`. Parse failure is a rejection.  
2. Exactly one statement. It is a `SELECT` (or `WITH ... SELECT`).  
3. Every relation referenced is in the allowlist: `analytics.*` views only. No `public.*`, no `ops.*`, no `pg_catalog`, no functions outside a small allowlist (`count, sum, avg, min, max, date_trunc, extract, coalesce, lead, lag, row_number, rank, percentile_cont, lower, upper`).  
4. Has a `LIMIT`. Injects `LIMIT 500` if missing on tier 3 SQL.  
5. No `INTO`, no `FOR UPDATE`, no `;` chaining, no comments.  
6. Outside unit tests: `EXPLAIN` on the scoped connection. Failure is a rejection with the Postgres error attached (goes back to the planner on tier 3).

### 4.8 Critic contract

Input: question, persona scope summary, plan (steps with kind and spec or sql), per-step `{row_count, columns, sample_rows (max 5), value}`, caveats.

Output: `{ pass: boolean; reason: string; fixes?: string }`.

Rubric in the prompt:

- Does each step's SQL actually compute what the plan says it computes?  
- Does the set of steps answer the question asked, not a nearby one?  
- Is a non-aggregated result with more than 50 rows being returned for a question that asked for a summary? Fail with "aggregate instead."  
- Is a result suspiciously empty where the question implies data should exist? Fail with "check filters."  
- Does any number the planner relied on come from outside the step results? Fail.

The critic sees no planner reasoning and no prior critique, only the artifacts.

### 4.9 Presenter and VizSpec

const VizSpec \= z.object({

  type: z.enum(\["stat","line","bar","calendar","table"\]),

  title: z.string().max(80),

  x: z.object({ field: z.string(), label: z.string() }).optional(),

  y: z.object({ field: z.string(), label: z.string() }).optional(),

  series: z.array(z.string()).optional(),

  caveats: z.array(z.string()),

});

`type` is chosen by code from `shape` before the LLM runs:

- `scalar` → `stat`  
- `series` (time on x) → `line`  
- `categories` → `bar`  
- `entity_by_day` → `calendar`  
- `rows` → `table`

The presenter may override `type` only within the enum, and must fill `title`, labels, and `caveats` (which it copies from state and may reword, never drop). Output: `{ answer_md: string; viz: VizSpec }`. Rows are fetched by the frontend from `ops.run_results`, not embedded.

### 4.10 Prompt layout and caching
System prompt for `plan`, in this order so the static prefix caches:

1. Role and principles (static).
2. Schema doc from process cache: views, columns, comments, domain notes (static per `schema_version`). Marked for prompt caching.
3. Metric registry summary and Spec schema (static).
4. Persona scope summary (per request).
5. Up to three episodes retrieved by sketch key, as "past plans that worked" (per request).
6. Resolved entities and dates (per request).
7. Last N messages and the question (per request).

`critique` and `present` get smaller prompts. Only `plan` needs the schema. `sketch` gets the metric names and the question, nothing else.

### 4.11 Process cache

Loaded at module init in the worker function (survives across warm invocations):

- `schemaDoc`: introspect `information_schema.columns` and `pg_description` for `analytics.*`, plus `memory.domain_notes` and `memory.schema_examples`. Hash → `schema_version`.
- `metricRegistry`: from `packages/shared`.
- Refresh when `schema_version` in `ops.schema_meta` differs from cached, checked once per invocation (one cheap query).

### 4.12 LLM call wrapper

`packages/agent/src/llm.ts`. Every model call in the graph goes through it. Nothing else imports the Anthropic SDK.

- One client, created at module init: `new Anthropic({ timeout: 30_000, maxRetries: 2 })`. The SDK retries 429, 5xx, 529 and connection errors with backoff. After that they surface as typed errors.
- `callStructured(schema, system, messages, { model, max_tokens, node })` uses `client.messages.parse` with `zodOutputFormat(schema)` and returns `{ output, usage }`.
- Before returning, in this order:
  1. `stop_reason === 'refusal'` → `LlmRefusedError` with `stop_details.category`. Non-retryable.
  2. `stop_reason === 'max_tokens'` → `LlmTruncatedError`. Non-retryable.
  3. `parsed_output === null` → `LlmParseError`. Non-retryable.
- `Anthropic.RateLimitError`, `Anthropic.InternalServerError`, `Anthropic.APIConnectionError` (which includes timeouts) → rethrown as `RetryableError`. The worker maps `RetryableError` to `status='queued'`, `attempt+1`. Everything else maps to `status='failed'` with the error class and message in `runs.error`.
- Every call writes one `llm_calls` row: node, model, prompt tokens, completion tokens, cache read tokens, latency, `git_sha`, 500-char excerpt. Same transaction as the node's `run_steps` row.
- After every call: if `runs.total_tokens + usage` exceeds `RUN_TOKEN_CAP`, throw `BudgetExceededError`. Non-retryable.
- The corrective retry for a schema-valid but invalid plan lives in `plan`, not here. The node appends the validation error as a user message and calls the wrapper again, once. A second failure goes to `fail`.

Test `llm.wrapper.test` (Phase 2) feeds a fake client each shape above and asserts the typed error that comes out.

### 4.13 Budgets

| Variable | Checked where | Effect when exceeded |
| :---- | :---- | :---- |
| `MONTHLY_TOKEN_BUDGET` | `/api/ask`, one `sum(total_tokens)` over `ops.runs` for the current calendar month | 429 before any run is created |
| `RUN_TOKEN_CAP` | LLM wrapper, after every call | `BudgetExceededError`, run fails, visible in `/ops` |

Both are plain env vars. Defaults: 5,000,000 and 150,000.

---

## 5\. Phase 2: Verify the structure (no database)
Vitest, all in `packages/agent` and `packages/shared`.

| Test | Asserts |
| :---- | :---- |
| `plan.schema.test` | Valid plans parse. Plans with 5 steps, unknown metric, unknown filter, bad ref syntax are rejected. |
| `sketch.schema.test` | Sketch output parses; unknown metric names are rejected; empty metrics is allowed (no retrieval). |
| `compiler.snapshot.test` | For every metric × a representative spec, the SQL snapshot matches. Same input twice is byte-identical. Scope predicate present for teacher persona, absent for super_admin. `my_history` compiles against `v_my_history` only. |
| `validator.test` | Rejects `DELETE`, `UPDATE`, `SELECT ... INTO`, two statements, `public.students`, `ops.runs`, `pg_sleep()`, missing LIMIT on tier 3. Accepts every compiler snapshot. |
| `refs.test` | `$a.value`, `$a.rows[0].student_id`, `$b.rows[*].x` resolve. Missing step, out-of-range index, wrong type fail with a readable error. |
| `calc.test` | Every named formula, edge cases: zero denominator, target unreachable, empty list. |
| `llm.wrapper.test` | Fake client returns refusal, max_tokens, null parsed output, 429 after retries, timeout: each produces its typed error. Token cap exceeded produces `BudgetExceededError`. |
| `episodes.templatize.test` | Questions with resolved entities become `{student}`, `{section}`, `{teacher}`, `{room}`, `{date_range}`; no name from `resolved` survives in the output. |
| `graph.topology.test` | With a fake executor and fake LLM: happy path visits sketch → plan → execute → critique → present. Sketch failure still reaches plan with no episodes. Critique fail replans at most twice then presents with `uncertain`. Validation fail on tier 3 regenerates at most twice then fails. Schema-valid but invalid plan gets exactly one corrective call. OutOfScope skips execute. |
| `state.size.test` | Serialized state after each node stays under 32 KB with a 500-row result (rows are not in state). |

Definition of done: all green, no database connection string in the test environment.

---

## 6\. Phase 3: Migrations

Plain SQL in `packages/db/migrations`, applied with the Supabase CLI. Every table and column that the LLM will see gets a `COMMENT`.

### 6.1 Database roles

| Role | Used by | Grants |
| :---- | :---- | :---- |
| `ask_moov_app` | `/api/ask`, `/api/worker` for ops writes, checkpointer, memory | `ops.*`, `memory.*`, `langgraph.*` read/write. No access to `analytics`. |
| `ask_moov_query` | `execute` node only | `SELECT` on `analytics.*` views only. `statement_timeout = 5s`. `default_transaction_read_only = on`. No `public.*`. |

Two connection pools in the worker. The query pool runs `SELECT set_config('app.role', $1, true), set_config('app.user_id', $2, true), set_config('app.school_id', $3, true)` at the start of every transaction.

### 6.2 Migration list

**001\_domain.sql** (schema `public`)

school\_calendar(school\_id, date, is\_school\_day, ab\_day)

bell\_schedule(school\_id, period, starts\_at, ends\_at)

rooms(id, school\_id, name, wing, floor, kind)            \-- kind: classroom, bathroom, cafeteria, gym, library, office, entrance

teachers(id, school\_id, name, email)

students(id, school\_id, name, grade)

cards(id, student\_id, type, status, issued\_at)            \-- type: permanent, temp; status: active, lost, deactivated

sections(id, school\_id, teacher\_id, course, period, room\_id)

rosters(section\_id, student\_id)

devices(id, school\_id, type, location\_id, status)         \-- type: reader, kiosk, handheld

                                                          \-- location\_id: the room or zone the device is set to. Readers: their classroom. Kiosks: whatever staff picked on the screen.

device\_heartbeats(device\_id, ts, online)

taps(id, school\_id, device\_id, location\_id, card\_id, student\_id, ts, direction, kind, result)

                                                          \-- location\_id: copied from the device at tap time, so history stays right if a kiosk is later moved

                                                          \-- direction: in, out

                                                          \-- kind: arrival, departure, pass\_start, pass\_end, check

                                                          \-- result: authorized, blocked, no\_card

passes(id, school\_id, student\_id, section\_id, origin\_room\_id, destination, issuer, started\_at, ended\_at)

attendance(section\_id, date, student\_id, status, source)  \-- status: present, absent, tardy; source: tap, manual

Indexes: `taps(student_id, ts)`, `taps(device_id, ts)`, `taps(location_id, ts)`, `passes(student_id, started_at)`, `passes(section_id, started_at)`, `attendance(section_id, date)`, `device_heartbeats(device_id, ts)`, `rosters(student_id)`.

`school_id` is on every fact table so super\_admin scope is a real predicate, not "no predicate."

**002\_analytics\_views.sql** (schema `analytics`)
All views are `CREATE VIEW ... WITH (security_invoker = true)`. Without `security_invoker`, a view runs as its owner and bypasses RLS on the base tables. This flag is the whole authorization story.

| View | Grain | Key columns |
| :---- | :---- | :---- |
| `v_attendance_daily` | student × section × date | status, source, period, teacher_id, room_id, wing |
| `v_tardies` | one row per tardy | student_id, kind (entry or period), section_id, period, date, minutes_late |
| `v_passes` | one row per pass | student_id, section_id, origin_room_id, wing, destination, issuer, started_at, ended_at, minutes, over_limit, period, day_of_week, ab_day |
| `v_entry` | one row per kiosk tap at entrance | student_id, ts, result, tardy, minutes_after_bell |
| `v_presence` | one row per arrival | student_id, location, location_kind, arrived_at, left_by, left_by_kind (exit_tap, pass_tap_out, next_arrival, end_of_day), next_location |
| `v_section_roster` | student × section | teacher_id, period, room_id, course |
| `v_cards` | student × card | type, status, issued_at, active_card_type, temp_ids_issued_30d |
| `v_device_uptime` | device × school hour | online_ratio, offline_minutes, room_id |
| `v_my_history` | one row per (run, resolved entity) asked by the current user | run_id, thread_id, asked_at, question, entity_type, entity_id, metrics, answer_excerpt |

`v_my_history` reads `ops.runs` and `ops.run_entities`, not `public`. It is still `security_invoker`; the RLS policy on those two tables (8.2) filters by `current_setting('app.user_id')`. It is recall of what the user asked, never evidence about a student.

Every view and column gets a `COMMENT`. Two that matter most:

```
COMMENT ON VIEW analytics.v_presence IS
 'One row per arrival. left_by is when the student is next seen somewhere else. left_by_kind says how: exit_tap and pass_tap_out are measured departures; next_arrival and end_of_day are inferred, so left_by is an upper bound on time at this location, not a measurement.';

COMMENT ON COLUMN analytics.v_attendance_daily.source IS
 'tap = marked present by reader tap. manual = teacher changed the status when saving attendance. A manual absent after a tap means the teacher did not see the student in the room.';
```

**003\_roles\_rls.sql**

Creates `ask_moov_app`, `ask_moov_query`. Enables RLS on every `public` fact table. Policies in Phase 5 (section 8).

**004\_ops.sql** (schema `ops`)
```
runs(id, thread_id, persona jsonb, question, status, current_node, attempt, path, queued_at, claimed_at, heartbeat_at, started_at, finished_at, latency_ms, total_tokens, cost_usd, schema_version, git_sha, uncertain, error, created_at)
run_steps(id, run_id, node, step_id, attempt, started_at, duration_ms, input_summary jsonb, output_summary jsonb, error)
run_results(run_id, step_id, columns jsonb, row_count, rows jsonb)
run_entities(run_id, entity_type, entity_id)          -- from state.resolved at run end; feeds v_my_history
llm_calls(id, run_id, node, model, prompt_tokens, completion_tokens, cache_read_tokens, latency_ms, git_sha, response_excerpt)
tool_calls(id, run_id, node, tool, args jsonb, result jsonb, duration_ms)
schema_meta(schema_version, loaded_at, frozen_now)
```

`status` is an enum: `queued, running, succeeded, failed`. `path` is `compiled, composed, generated`. Indexes: `runs(status, queued_at)`, `runs(thread_id, created_at)`, `run_entities(entity_type, entity_id)`.

**005_memory.sql** (schema `memory`, extension `pg_trgm` only)

```
episodes(id, role, question_templated, plan jsonb, metrics text[], shape, critique jsonb, score int, schema_version, git_sha, created_at)
episode_feedback(episode_id, run_id, user_id, vote, created_at)   -- vote: 1 or -1
domain_notes(topic, text)                                          -- curated, section 15; changes only by migration
schema_examples(view_name, question, spec jsonb, sql)
```

No `vector` extension. `episodes` never stores result rows or names: entities are templatized to `{student}`, `{section}`, `{teacher}`, `{room}`, `{date_range}` before insert. Indexes: GIN on `episodes(metrics)`, GIN trigram on `episodes(question_templated)`, `episode_feedback(episode_id)`.

**006_langgraph.sql**

Tables required by `@langchain/langgraph-checkpoint-postgres` in schema `langgraph`. Use the package's `setup()` once, then commit the resulting DDL here so migrations are the source of truth.

**007_cron.sql**

- Enable `pg_cron` and `pg_net`. `APP_URL` and `WORKER_SECRET` live in Supabase Vault, read inside the function via `vault.decrypted_secrets`.
- Function `ops.redispatch()`:
  1. `UPDATE ops.runs SET status='queued', queued_at=now() WHERE status='running' AND heartbeat_at < now() - interval '2 minutes' AND attempt < 3`.
  2. `UPDATE ops.runs SET status='failed', error='attempts exhausted' WHERE status='running' AND heartbeat_at < now() - interval '2 minutes' AND attempt >= 3`.
  3. For every run with `status='queued' AND queued_at < now() - interval '1 minute'`: `net.http_post(app_url || '/api/worker', jsonb_build_object('run_id', id), headers with x-worker-secret)`.
- `cron.schedule('redispatch', '* * * * *', 'select ops.redispatch()')`.
- No Database Webhook. Nothing to configure in the dashboard beyond the two Vault secrets.

Definition of done: `supabase db reset` applies cleanly. `\dv analytics.*` shows 9 views with comments. `SELECT * FROM analytics.v_passes` as `ask_moov_query` without `set_config` returns zero rows. `SELECT jobname FROM cron.job` shows `redispatch`.

---

## 7\. Phase 4: Seed

`packages/db/seed/generate.ts`, deterministic, takes `--seed 42 --scale 1.0`.

### 7.1 Sizes

Springfield High: 1,500 students, 90 teachers, 110 rooms (80 classrooms, 8 bathrooms, cafeteria, gym, library, office, 2 entrances), 8 periods, A/B rotation, 30 school days ending on the frozen "now." Shelbyville High: 300 students, same shape, so super\_admin has two schools to compare.

Frozen now: Tuesday, October 13, 2026, 10:40 AM, 3rd period in progress. Everything "live" is computed against this timestamp.

### 7.2 Generation order

1. Calendar and bell schedule.  
2. Rooms, wings, floors, zones. Each classroom has a reader. Five kiosks: two at the entrance, one each at cafeteria, gym, and office, each with its `location_id` set. 6 handhelds assigned to staff. No exit taps are generated; `direction = out` only occurs on pass tap-outs.  
3. Teachers, sections (each teacher 5 sections), rooms assigned.  
4. Students with grade, rosters (each student 7 sections), cards (one permanent each; 4% also have an active temp).  
5. Per school day, per student: an entry tap between 7:30 and 8:15 (90% of students; 8% arrive after bell; 2% absent); per scheduled section a classroom tap in the first 6 minutes of the period (96% baseline present).  
6. Passes derived: 22% of student-periods produce a bathroom tap-out, duration log-normal around 6 minutes; 3% produce a teacher-created pass to nurse, office, library, or counselor with a destination tap at that room's reader where one exists.  
7. Attendance derived from taps. 2% of tapped-present rows get `source = manual, status = absent` (teacher override). 1% get `source = manual, status = present` (no tap, teacher marked present).  
8. Device heartbeats every 2 minutes for every device. Inject outages (section 7.3).  
9. Handheld taps: 15 per day per handheld, random hallway students during passing time, `result` mostly authorized.

### 7.3 Planted stories

Each is a function applied after the baseline, so it can be toggled off for the null-data test.

| \# | Story | Shows |
| :---- | :---- | :---- |
| 1 | Nelson and Jimbo tap out within 3 minutes of each other from different rooms, 6 of the last 8 Tuesdays, 3rd period | co-occurrence |
| 2 | Milhouse's bathroom pass average climbs 5 → 9 → 14 → 19 minutes over 6 weeks, never over the 20-minute limit | drift under threshold |
| 3 | 6th period produces 3× the tap-outs of any other period, concentrated in the east wing | hot spot by period and wing |
| 4 | Ralph taps the entrance every Friday, then zero classroom taps after period 2, 4 of 5 Fridays | in building, not in class |
| 5 | Bart's tardies drop from 8 to 1 over three weeks | positive trend |
| 6 | Room 214's reader is offline 9:50 to 10:20 on October 6 and 8 | data-quality caveat |
| 7 | Lisa has 34 present out of 40 scheduled in Ms. Hoover's section; asking "how many more to hit 90%" yields 20 | calc |
| 8 | Martin is on his 4th temp ID this month; his permanent card is deactivated | temp\_id\_count, active\_card\_type |
| 9 | Ms. Krabappel overrides tap attendance to absent 6 times for Bart in two weeks | teacher contradiction |
| 10 | Entrance 2 has a 7:52 to 7:58 surge of 180 taps every day (bus arrival) | entry by time bucket |
| 11 | Shelbyville's attendance rate is 3 points lower than Springfield's | super\_admin comparison |
| 12 | At 10:40 on the frozen day, 31 students are mid-pass; 2 have been out more than 20 minutes | live questions |

### 7.4 Null-data check

`npm run seed -- --no-stories` then run the Phase 9 golden set. Every "pattern" question must return nothing interesting (no pair with 5+ same-period overlaps, no drift slope above threshold). This proves the planted stories are what the agent finds, not noise. Record the result in the README.

Definition of done: `npm run seed` produces identical row counts and checksums on repeat runs. Row counts: roughly 1.1M taps, 160K passes, 320K attendance rows, 2M heartbeats for Springfield. Adjust `--scale` if Supabase free tier complains.

---

## 8\. Phase 5: Authorization

### 8.1 Roles and scopes

| Role | Sees |
| :---- | :---- |
| `teacher` | Students on their rosters, their own sections, passes and attendance for those sections, presence events for their students. No device data. No other teachers' sections. |
| `admin` | Everything in their `school_id`. Device data for their school. |
| `super_admin` | Everything, all schools. |

Scope is a function of `(role, user_id, school_id)`. Nothing else.

### 8.2 Enforcement

Policies on the `public` fact tables, evaluated through the `security_invoker` views:

\-- example: passes

CREATE POLICY passes\_teacher ON public.passes FOR SELECT TO ask\_moov\_query

USING (

  current\_setting('app.role', true) \= 'teacher'

  AND section\_id IN (

    SELECT id FROM public.sections WHERE teacher\_id \= current\_setting('app.user\_id', true)::int

  )

);

CREATE POLICY passes\_admin ON public.passes FOR SELECT TO ask\_moov\_query

USING (

  current\_setting('app.role', true) \= 'admin'

  AND school\_id \= current\_setting('app.school\_id', true)::int

);

CREATE POLICY passes\_super ON public.passes FOR SELECT TO ask\_moov\_query

USING (current\_setting('app.role', true) \= 'super\_admin');

Same pattern for `taps`, `attendance`, `students`, `rosters`, `cards`, `device_heartbeats`, `devices`. Dimension tables (`rooms`, `teachers`, `sections`, `school_calendar`, `bell_schedule`) are readable by all three roles within `school_id` (super\_admin: all).

A teacher's `taps` policy: `student_id IN (SELECT student_id FROM rosters r JOIN sections s ON s.id = r.section_id WHERE s.teacher_id = ...)`. This means a teacher can see where their student tapped in the cafeteria, which is reasonable, but not students they don't teach.

History scope. `ask_moov_query` also gets `SELECT` on `ops.runs` and `ops.run_entities`, each with one policy: `USING ((persona->>'user_id')::int = current_setting('app.user_id', true)::int)`. `analytics.v_my_history` is `security_invoker` like every other view, so a user sees only their own past questions. That holds for every role, including super_admin: history is per user, not per scope.

### 8.3 Why this is not "the agent sees everything and filters"

The `execute` node opens a transaction on the `ask_moov_query` pool and runs `set_config` for role, user, school before any query. The role has no grants on `public.*` and only `SELECT` on `analytics.*`. Views are `security_invoker`, so RLS on the base tables applies to the view query. If the planner emits a spec for a section the teacher does not teach, the compiler adds the scope predicate (defense in depth), and even if it did not, RLS returns zero rows. There is no code path where out-of-scope rows reach the LLM, the result store, or the UI.

The planner also receives a scope summary ("you are answering for Edna Krabappel, who teaches sections 4B, 5A, 6C") so it can say "that section is outside your scope" instead of running a query that returns nothing. That message is a convenience. The empty result is the guarantee.

### 8.4 Tests

| Test | Asserts |
| :---- | :---- |
| `rls.teacher.test` | As teacher 17, `SELECT count(*) FROM analytics.v_passes` equals the count for their sections only. Querying another teacher's section id returns 0\. |
| `rls.admin.test` | As admin of school 1, zero rows from school 2\. |
| `rls.super.test` | Both schools visible. |
| `rls.noconfig.test` | Query pool without `set_config` returns 0 rows everywhere. |
| `rls.bypass.test` | `ask_moov_query` cannot `SELECT FROM public.passes` directly (permission denied). |
| `e2e.scope.test` | Teacher asks "How many bathroom passes did Nelson take this month?" where Nelson is not on their rosters → OutOfScope `permission`. Admin asks the same → number. |
| `rls.history.test` | As user 12, `v_my_history` returns only runs whose `persona->>'user_id'` is 12, across all of user 12's threads. As user 13, zero of them. |

---

## 9\. Phase 6: Observability
### 9.1 Write points

| When | Table | Row |
| :---- | :---- | :---- |
| `/api/ask` | `runs` | insert, `queued`, `queued_at`, `git_sha` |
| `/api/worker` claim | `runs` | `running`, `attempt`, `claimed_at`, `heartbeat_at` |
| every node start/end | `run_steps` | one row per node per attempt, with `input_summary` and `output_summary` (summaries, not full state) |
| every node end | `runs` | `current_node`, `heartbeat_at` |
| every LLM call | `llm_calls` | model, tokens, cache reads, latency, `git_sha`, 500-char excerpt |
| every tool call | `tool_calls` | tool, args, result, duration |
| `execute` step done | `run_results` | columns, row_count, rows (capped at 500) |
| graph end | `run_entities` | one row per entity in `state.resolved` |
| graph end, critic passed | `episodes` | templated question, plan, metrics, shape, score 1 |
| graph end, replans exhausted | `episodes` | same, score -1 |
| thumbs up / down | `episode_feedback` | vote; `episodes.score` updated in the same transaction |
| graph end | `runs` | `succeeded` or `failed`, `latency_ms`, `total_tokens`, `cost_usd`, `path`, `uncertain` |

Writes are batched per node (one transaction), never per token.

### 9.2 `/ops` queries

- p50 / p95 latency, last 7 days, by `path`.
- Critic fail rate, replan rate, tier 3 rate.
- Cost per question, tokens per question, cache hit ratio. Month-to-date tokens against `MONTHLY_TOKEN_BUDGET`.
- Failures by node, last 20 failed runs with error.
- Top 20 questions by frequency (templated).
- Runs currently `running` with `current_node` and heartbeat age. Runs `queued` older than 1 minute (should be zero).
- Episodes: count stored, retrieval hit rate (share of runs with at least one episode injected), score distribution, feedback votes last 7 days.
- Runs by `git_sha`, so a prompt or code change can be compared before and after.

### 9.3 Status transport

The UI polls `GET /api/runs/[id]` every second while a run is `queued` or `running`, and stops on `succeeded` or `failed`. The route returns `status`, `current_node`, `attempt`, the `run_steps` so far, and on success the answer, VizSpec, caveats, SQL per step, and rows from `run_results`. No Realtime, no SSE, no websockets.

---

## 10\. Phase 7: Durability
Covered in section 2.1. Additional details:

- `/api/worker` verifies `x-worker-secret` against `WORKER_SECRET` before anything else. Its only callers are `/api/ask` (the ping), the worker itself after a retryable requeue, and `ops.redispatch()` via pg_net.
- The claim UPDATE is the concurrency lock. The ping and the cron hitting the same run result in one worker.
- The worker returns 202 right after the claim and runs the graph in `after()` from `next/server`, so the caller is not held open and the function stays alive up to `maxDuration = 300` in the route segment config.
- Heartbeat is written after every node. Stale-running threshold is 2 minutes. Stale-queued threshold is 1 minute.
- `RetryableError` (4.12) → `queued`, `attempt + 1`, one self-ping. Any other error → `failed` with the error class in `runs.error`. Three attempts maximum either way.
- Chaos flag: `runs.persona.chaos = { crash_after: "execute" }` makes the worker throw after that node on attempt 1 only. Used in the Loom to show resume. Disabled in production by env var.
- `thread_id` is stable across runs in a conversation. `run_id` is per question. The checkpointer namespace is `thread_id`, and `run_id` is in the checkpoint metadata so a resumed run finds its own partial state.

Tests:

- `durability.resume.test` enqueues a run with `crash_after = execute`, asserts the run reaches `succeeded` on attempt 2 and that `run_steps` has exactly one `sketch`, one `plan` and one `execute` row (not re-run).
- `durability.redispatch.test` inserts a `queued` run with `queued_at` two minutes ago and a `running` run with `heartbeat_at` three minutes ago, calls `ops.redispatch()`, and asserts the running run is back to `queued` and both ids were posted to the worker URL.

---

## 11\. Phase 8: Memory

### 11.1 Thread memory

LangGraph `PostgresSaver` on the `ask_moov_app` pool. Checkpoint after every node and after every step inside `execute`. `messages` trimmed to the last 10 turns before `plan`.

Entity pinning lives here. When a clarification resolves, or a lookup returns a single confident match, the entity is written to `state.resolved.entities` and persists for the rest of the thread. "Bart" means the same Bart until the user names a different one. Pins are per thread on purpose: a new conversation asks again, which is correct for an admin who asks about different students on different days.

No Redis. The checkpointer is the session store. It survives restarts and is what resume reads from.

### 11.2 Episodic
Episodic memory is the system remembering which plans worked. No vectors, no embeddings, no names.

Written once per run, after `critique` passes and `present` completes:

- `question_templated`: the question with every entity in `state.resolved` replaced by its type: `{student}`, `{section}`, `{teacher}`, `{room}`, `{date_range}`. Nothing else from the run is stored. No rows, no answer text.
- `plan` (the final plan JSON), `metrics` (every metric used across its steps), `shape` (`expected_shape`), `critique`, `schema_version`, `git_sha`, `score = 1`.
- A run that exhausted replans is written with `score = -1` so it is excluded from retrieval but visible in `/ops`.

Feedback: thumbs up inserts `episode_feedback(vote = 1)` and adds 1 to `score`. Thumbs down inserts `vote = -1` and subtracts 2. Same transaction. Retrieval filters `score >= 0`.

Retrieval runs in code inside `plan` pre-processing, keyed by the `sketch` node's output:

```
SELECT id, question_templated, plan
FROM memory.episodes
WHERE metrics && $sketch_metrics
  AND shape = $sketch_shape
  AND role = $persona_role
  AND score >= 0
ORDER BY (schema_version = $current_schema_version) DESC, score DESC, created_at DESC
LIMIT 3
```

If fewer than 3 come back, fill the remainder with pg_trgm: same `role` and `score >= 0` filters, excluding ids already picked, ordered by `similarity(question_templated, $question_templated)` desc. The result is injected into the planner prompt as "past plans that worked", each as the templated question plus its plan JSON.

`EPISODES_ENABLED=false` skips retrieval entirely and is what the eval runner uses for its first pass (section 12). Writing is never skipped.

### 11.3 What is deliberately not here

No user-level alias memory. "My 4th period" resolves from the persona. "Ms. K" is ambiguous by design and gets a clarification. A disambiguation made in one thread does not carry to another.

No vectors or embeddings. Retrieval is keyed by metric and shape, with trigram similarity as fill. Those are exact matches and a number, not a model.

No learned domain knowledge. `domain_notes` is written by us, loaded into the prompt, and changes only by migration. The agent cannot add to it.

History (14.1) is not memory. It is recall of what a user asked, lives in `ops`, and is served through a view like any other data.

Two tiers only: the conversation remembers itself (11.1), the system remembers what worked (11.2).

---

## 12\. Phase 9: Evals
`packages/evals/golden/*.json`, one file per persona. 30 cases minimum.

```json
{
  "id": "teacher-attendance-rate-section",
  "persona": { "role": "teacher", "user_id": 12, "school_id": 1 },
  "question": "What's the attendance rate in my 4th period this month?",
  "expect": {
    "kind": "plan",
    "steps": [{ "kind": "spec", "spec": { "metric": "attendance_rate", "entity": { "type": "section" } } }],
    "result": { "step": "a", "value_between": [0.90, 0.97] },
    "viz_type": "stat",
    "caveats_include": []
  }
}
```

Runner: for each case, invoke the graph directly (no HTTP), assert plan shape with partial deep match, assert result predicate, assert viz type, assert no out-of-scope rows (row-level check against the persona's scope), record latency and tokens. Runs in CI against a seeded Supabase branch.

The runner executes the golden set twice: first with `EPISODES_ENABLED=false` on an empty `episodes` table, then with `EPISODES_ENABLED=true` using the episodes the first pass wrote. `evals/report.md` has one table per pass and a delta row: pass count, replan rate, tier 3 rate, tokens per question, p50 latency. The delta is reported as measured. Zero or negative is a valid result and is written down as such.

Include 6 out-of-scope cases (one per reason), 3 tier 3 cases that intentionally fall outside the metric registry, and 3 history cases: one named student, one date range only, and one "this student" with no name that must produce `needs_clarification` with options from `v_my_history`.

---

## 13\. Phase 10: Frontend (last)
Build order within the phase:

1. Persona switcher in the header: three personas, each a real `(role, user_id, school_id)`. Switching starts a new `thread_id`.
2. Thread list in a sidebar: the persona's threads from `ops.runs` grouped by `thread_id` (first question, last `asked_at`). Clicking one reopens it; the next question continues that thread.
3. Chat: question input, message list, status line driven by polling `/api/runs/[id]` (`planning → running step 2 of 3 → checking → done`).
4. Answer card: `answer_md` rendered with raw HTML disabled, `VizRenderer(viz, rows)`, caveats as a muted list, collapsible "SQL" section per step, thumbs up / down posting to `/api/runs/[id]/feedback`.
5. Clarification chips: `options` from `needs_clarification`. Clicking one sends the chosen entity as the next message in the thread, so it gets pinned.
6. `VizRenderer`: `stat`, `line`, `bar`, `table`, `calendar`. Recharts for line and bar. Calendar is a 7-column grid of the date range with a color per status.
7. "What can I ask?" chip: renders the metric registry as example questions for the current persona.
8. `/ops` page: the queries in section 9.2 as cards and small tables. No charts needed beyond a latency histogram.

No auth. No settings. No mobile layout beyond "doesn't break".

---

## 14\. Question catalog

### 14.1 Answerable shapes

| Shape | Example | Path |
| :---- | :---- | :---- |
| Lookup | When did Bart last tap into the building? | spec: `last_known_location` with `time_point = now` |
| Aggregate | Average attendance in Ms. Hoover's 4th period this month | spec: `attendance_rate` |
| Ranking | Top 10 students by out-minutes this week | spec: `out_minutes`, group\_by student, order desc, limit 10 |
| Trend | Tardies week over week since September | spec: `tardy_count`, group\_by week |
| Comparison | Bathroom passes on A days vs B days | two specs or one with group\_by ab\_day |
| Co-occurrence | Who is out at the same time as Nelson most often? | tier 3 (self-join on `v_passes`) until a `pass_overlap` metric is added |
| Projection | How many more classes does Lisa need to hit 90%? | spec \+ calc `classes_to_target` |
| Calendar | Show me Ralph's attendance this month | spec: `present_count` group\_by day → `calendar` |
| Live | Who's in the halls right now? | spec: `who_was_where` or `v_passes` with `ended_at IS NULL` |
| Presence | Who tapped into the gym between 2:00 and 2:15? | spec: `visits_to_location` with time\_range |
| Data quality | Was the Room 214 reader online during 3rd period on October 6? | spec: `device_uptime` |
| Departure | Who has left the building? | inferred: students with no taps after period N, labeled inferred. Exit kiosks would make this measured; this school has none. |
| History | What did I ask about this student last week? | spec: `my_history` with `entity` and `time_range` over `v_my_history`. If "this student" resolves to no entity, `needs_clarification` with options built from `v_my_history` (students the user asked about in the range, with counts), not from `lookup_entity`. |

### 14.2 Out of scope, by reason

| Reason | Example | Response |
| :---- | :---- | :---- |
| `not_in_data` | What are Bart's grades? | "I only have tap, pass, attendance and device data. I can show you his attendance or tardies." |
| `identity` | Is Bart sharing his card? | "Taps show where a card was, not who held it. I can show you Bart's overlapping passes with other students." |
| `action` | Set a buddy block for Nelson and Jimbo | "I can't change settings. Here's the overlap data to bring to an admin." |
| `permission` | (teacher) How many passes did Nelson take? (not on roster) | "Nelson isn't in any of your sections, so that's outside your scope." |
| `advice_or_prediction` | What should I do about Nelson? | "That's a judgment call. Here's his pass history for the last month." |
| `needs_clarification` | How many passes did Bart take? (two Barts) | "Which Bart?" with chips: "Bart Simpson, 9th, your 4th period" / "Bart Reyes, 11th". Also used for vague metrics ("how is Bart doing?" → attendance, tardies, or passes?), vague dates, and "this student" with no resolvable entity, where the chips come from `v_my_history` ("Bart Simpson, asked 3 times this week"). |

---

## 15\. Domain notes (seed content for `memory.domain_notes`)

taps:          A tap on a classroom reader has no intrinsic direction. First tap of the period marks present. A tap while present starts a pass. A tap while out ends the pass. Direction is derived by the backend.

exit\_taps:     Kiosks can record exits when set to an exit mode, but this school does not use one. In this data the only departure events are pass tap-outs on classroom readers. "Who has left" is inferred from the absence of later taps and must be labeled inferred.

kiosk\_location: A kiosk's location is set on its screen by staff. taps.location\_id is the kiosk's location at tap time. Treat it as authoritative.

one\_active\_card: Only one ID is active per student at a time. Issuing a temp ID deactivates the permanent card. "Two active cards" cannot occur; use temp\_id\_count and active\_card\_type instead.

bathroom:      Bathroom passes default to the nearest bathroom and have no destination tap. Destination is assumed, not verified.

attendance:    attendance\_rate \= present / scheduled meetings for the student in that section over the range. Scheduled meetings come from school\_calendar and the section's period.

tardy:         Entry tardy \= kiosk tap after first bell \+ 5 minute grace. Period tardy \= classroom tap more than 5 minutes after period start.

manual:        attendance.source \= manual means the teacher changed the status while saving. Manual absent after a tap means the teacher did not see the student.

devices:       If a device has no online heartbeat for a window, taps in that window are missing, not absent. Always check v\_device\_uptime for the room and window before interpreting a gap as absences.

scope:         Teachers see their rosters and sections. Admins see their school. Super admins see all schools. Results are already filtered; do not re-filter by role.

ab\_day:        The school runs an A/B rotation. Period numbers are the same on both; room assignments can differ.

now:           "Now" for live questions is the frozen timestamp in ops.schema\_meta.frozen\_now.

history:       v_my_history is what the current user asked before, across threads. It is recall, not evidence about a student. "This student" with no name resolves from history or asks; it is never guessed.

---

## 16\. Non-goals for v1
- Authentication. Personas are chosen, not logged in.
- Writes of any kind to domain data. No buddy blocks, no passes, no overrides.
- Multi-tenant beyond two seeded schools.
- Real SIS integration.
- Mobile layout.
- Streaming tokens. Status is polled; the answer arrives whole.
- Realtime, websockets, server-sent events, Database Webhooks.
- Vector search or embeddings of any kind.
- Learned domain knowledge. `domain_notes` changes only by migration.

---

## 17\. Environment and commands
```
DATABASE_URL_APP=postgres://ask_moov_app:...
DATABASE_URL_QUERY=postgres://ask_moov_query:...
ANTHROPIC_API_KEY=
APP_URL=                      # public base URL; /api/ask pings APP_URL/api/worker; also stored in Vault for the cron
WORKER_SECRET=                # value of the x-worker-secret header; also stored in Vault
MONTHLY_TOKEN_BUDGET=5000000
RUN_TOKEN_CAP=150000
EPISODES_ENABLED=true
CHAOS_ENABLED=false
VERCEL_GIT_COMMIT_SHA=        # set by Vercel; locally the app falls back to `git rev-parse HEAD`
```

```
npm run db:reset               supabase db reset, applies all migrations
npm run seed                   deterministic seed with stories
npm run seed -- --no-stories   null-data baseline
npm test                       Phase 2 and Phase 5 tests
npm run evals                  golden set twice (episodes off, on), writes evals/report.md
npm run dev                    next dev
```

---

## 18\. Definition of done, overall
- A teacher persona asks a question about a student not on their roster and gets a scope message; the `run_results` row for that run is empty and `rls.teacher.test` proves the DB returned nothing.
- A run with `crash_after = execute` finishes on attempt 2 without re-running `sketch`, `plan`, or `execute`.
- A run whose worker died is picked up by `ops.redispatch()` within one minute, with no webhook configured anywhere.
- `/ops` shows p95 latency, tier 3 rate, critic fail rate, month-to-date tokens, and episode stats from real runs.
- Golden evals pass on seeded data and return nothing interesting on `--no-stories` data. `evals/report.md` shows both passes, episodes off and on, with the delta as measured.
- A user can reopen a past thread and ask what they asked about a student. "This student" with no name yields a clarification built from their own history.
- No table in `memory` contains a student name or a result row.
- Every answer shows its SQL and its caveats.
- README has a section titled "What tap data can and cannot tell you."

---

## 19\. Changes in v1.1 (October 18, 2026)

1. Transport and infrastructure: removed Supabase Database Webhooks, Realtime, pgvector, the embeddings API, and the prompt hash. Added the worker ping from `/api/ask`, `ops.redispatch()` on pg_cron every minute for runs queued over 1 minute or running with a heartbeat over 2 minutes, UI polling of `/api/runs/[id]`, `MONTHLY_TOKEN_BUDGET` and `RUN_TOKEN_CAP`, `git_sha` on every run and LLM call, the LLM wrapper in 4.12, and markdown rendering with raw HTML off.
2. `memory.semantic_notes` renamed to `memory.domain_notes`. It is curated domain knowledge loaded into the planner prompt. Nothing in code or docs is called "semantic memory".
3. Episodic memory stays, without vectors: new `episodes` and `episode_feedback` shapes, a `sketch` node before `plan` whose output is only the retrieval key, retrieval by metric overlap and shape with trigram fill, scoring rules, a two-pass eval report, and episode stats in `/ops`.
4. History question shape: `ops.run_entities`, `analytics.v_my_history`, the `my_history` metric, clarification from history for "this student", and a thread list in the UI.
5. The entity resolution contract in 4.5a is final and unchanged. Code decides ties, the LLM only extracts names and constraints, and the two post-planner checks stay.
