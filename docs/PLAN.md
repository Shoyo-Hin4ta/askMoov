# Ask MOOV: build plan and checklist

Spec: `docs/ask-moov-design.md` (v1.2). This file is the running checklist. Tick items as they land. Session logs live in `docs/sessions/`.

Status (2026-10-26): the section-chip loop and the deployment's connection exhaustion are fixed in code (session log 2026-10-26); the Vercel database URLs still need moving to the transaction pooler (port 6543), and episodic memory stores names in critique text (open). 224 unit tests, 24 database tests (also green on the transaction pooler), 91 golden cases (31 teacher). Status (2026-10-24): built, verified, ready to deploy. 90 golden cases (30 per persona, every number computed from the seed as the persona); latest full two-pass run 89/90 with episodes off, 90/90 on (packages/evals/report.md, 2026-10-24 05:40 UTC); the one miss is fixed in the compiler and reruns green. 191 unit tests, 24 database tests (authorization, durability, memory, transcripts, route), typecheck and lint clean, production build compiles. 22 migrations applied (today: checkpoint retention, run_output.labels, llm transcripts). Every model round now keeps its full request and response for 7 days and `/api/runs/[id]/trace` serves a run top to bottom. After the live UI verification: the critic and presenter get code-computed facts and entity names per step, two-dimension breakdowns are a grouped bar with a wing caveat, trend questions default to the school year, labels and the stored vote travel with the run view (frontend half pending in the other session). Done 2026-10-24: lease-renewal heartbeat on a 30 s timer fenced to the claim; compiler casts range bounds to the column's type so RLS queries use their indexes (Gym count 2074 ms → 7 ms); strict planner schemas; filters take one value or a list; chaos crash as a retryable requeue; model-client injection; entity lookup requires first-name agreement on two-word names and strips honorifics; compiled history is one row per question; templatize single pass; per-run token cap across attempts; `npm run db:vault`; HANDOFF rewritten. Pushed to `github.com/Shoyo-Hin4ta/askMoov` and deployed at `https://ask-moov.vercel.app` (2026-10-24 03:08 UTC: live question on Vercel 12 s, cron re-dispatch reached Vercel with a 202 and finished the run on attempt 2). Left: null-data baseline (needs Ritik's go: two reseeds). Design doc brought to v1.2 (section 20).

## Architecture in one picture

```
Browser (Next.js UI)
  persona switch · thread list · chat · answer card (md, viz, caveats, SQL, thumbs) · /ops
      │ POST /api/ask {run_id, thread_id, persona, question}
      │ GET  /api/runs/[id]            polled every 1s
      │ POST /api/runs/[id]/feedback   thumbs → episode score
      ▼
Next.js API routes (Vercel, maxDuration 300)
  /api/ask      monthly budget check → insert ops.runs (queued) → ping /api/worker → 202
  /api/worker   verify x-worker-secret → claim (UPDATE … WHERE status='queued') → 202 → run graph in after()
  /api/runs     read ops.runs / run_steps / run_results → status or result
      │
      ▼
LangGraph graph (packages/agent)               fixed graph, LLM fills content, code controls
  sketch ──► plan ──► execute ──► critique ──► present
             ▲         │            │
             └─────────┴────────────┘  replan ≤ 2
  tools (read-only): lookup_entity · resolve_dates · calc
  code: compiler (spec→SQL) · validator (libpg-query allowlist) · refs · episodes retrieval · llm wrapper
      │ app pool: ask_moov_app              │ query pool: ask_moov_query + set_config(role, user_id, school_id)
      ▼                                     ▼
Supabase Postgres
  ops.*  (runs, run_steps, run_results,     analytics.v_* (security_invoker)
          run_entities, llm_calls,                 │
          tool_calls, schema_meta)                 ▼
  memory.* (episodes, episode_feedback,     public.* domain tables with RLS by role
            domain_notes, schema_examples)
  langgraph.* (checkpoints)
  pg_cron + pg_net: ops.redispatch() every minute → POST /api/worker for stale runs
```

Three query tiers: compiled (spec → SQL by code), composed (several compiled steps + calc, wired by `$refs`), generated (model-written SQL, parser-allowlisted, EXPLAINed). Recorded in `runs.path`.

Viz type is chosen by code from the result shape (scalar→stat, series→line, categories→bar, entity_by_day→calendar, rows→table); the model fills title, labels, caveats only.

Three memory-like stores, named precisely: thread memory (checkpoints + pinned entities), domain notes (curated, loaded into the prompt, changes only by migration), episodic memory (plans that worked, keyed by metric + shape, trigram fill, no names, no vectors). Nothing is called "semantic memory".

Three failure responses: retry (transient), correct (one fix-up call), fail fast (named error). Idempotency via `run_id` + claim lock. Checkpoints so retries never redo finished nodes.

Access: Postgres RLS on base tables, `security_invoker` views, read-only query role, column-level grants (no emails), session variables set by code from the persona. The model never holds a connection, is never told who is asking, and cannot change scope. Permission messages come from what the database returns (a lookup that finds nothing), not from a scope hint in the prompt.

## Workspace layout (npm workspaces)

```
apps/web            Next.js: UI, /api/ask, /api/worker, /api/runs, /ops
packages/shared     Zod schemas (Plan, Spec, Sketch, VizSpec, Persona, OutOfScope), metric registry
packages/agent      graph, nodes, tools, compiler, validator, refs, llm wrapper, prompts, process cache, episodes
packages/db         seed generator, db clients (app pool, query pool), role setup
supabase/           Supabase CLI config and migrations (plain SQL, timestamped)
packages/evals      golden set + runner + report
docs/               design doc, this plan, session logs
CLAUDE.md           project rules
```

## Phases

### Phase 0: Scaffold
- [x] npm workspaces root, TypeScript base config, Vitest config
- [x] `apps/web` Next.js 16.4 app runs on `npm run dev` (port 3100; 3000 is taken by another process)
- [x] empty packages with `src/index.ts`, workspace links resolve
- [x] `CLAUDE.md`, `.env.example`, `.gitignore`, `.env` (local, direct DB host; use the session pooler host on Vercel)
- Verify: `npm run dev` serves a page; `npm test` runs (zero tests) and exits 0

### Phase 1: Agentic structure (no DB, no API key needed to write)
- [x] `shared`: Plan, Step, Spec, OutOfScope, Sketch, VizSpec, Persona schemas; metric registry (20 metrics incl. `my_history`, `scheduled_count`, `students_at_location`)
- [x] `agent/llm.ts`: single Anthropic client, `callStructured` with bounded tool loop, typed errors, token cap, llm_calls write hook
- [x] `agent/refs.ts`: `$a.value`, `$a.rows[i].col`, `$a.rows[*].col`
- [x] `agent/compiler.ts`: spec → `{sql, params, shape}` for every metric; scope predicate; caveats for inferred metrics
- [x] `agent/validator.ts`: libpg-query parse, single SELECT, `analytics.*` only, function allowlist, LIMIT, no comments
- [x] `agent/tools/`: lookup_entity (code decides ties), resolve_dates (typed input, code does calendar math), calc (named formulas + sandboxed expr)
- [x] `agent/episodes.ts`: templatize, retrieve (metrics && shape, trigram fill), write, score
- [x] `agent/prompts.ts`: sketch, plan, critique, present; data delimited as data; cache breakpoint after schema doc
- [x] `agent/graph.ts`: state, six nodes, edges, limits (4 steps, 2 replans, 2 SQL regens, 1 corrective call, 60s)
- [x] `agent/schema-doc.ts`: process cache, introspection; `schema_version` is computed by the database from the catalog in one query per worker invocation (no manual bump)
- Verify: Phase 2

### Phase 2: Unit tests (no database)
Priority per Ritik: tests are not the focus right now. Keep the three that guard the security boundary; defer the rest.
- [x] now: validator · compiler.snapshot (scope predicate) · llm.wrapper · graph.topology (9 cases incl. chaos resume and pins) · resolve_dates
- [x] plan.schema · sketch.schema · refs · calc · episodes.templatize · state.size (2026-10-23: `plan-schema.test.ts`, `refs.test.ts`, `episodes.test.ts`, the state-size case in `graph.test.ts`; the templatize test caught `{{room}}`, fixed)
- Verify: all green with no `DATABASE_URL_*` and no `ANTHROPIC_API_KEY` in the environment

### Phase 3: Migrations (Supabase CLI, `supabase/migrations/`)
- [x] domain (14 tables incl. schools, indexes, comments) — written
- [x] ops (incl. `run_entities`, `queued_at`, `git_sha`, `metrics`, `answer_excerpt`, `schema_meta.frozen_now`) — written
- [x] memory (pg_trgm only; episodes, episode_feedback, domain_notes seeded with 14 notes, schema_examples with 8) — written
- [x] langgraph checkpoint tables (final DDL, versions 0-5 pre-recorded) — written
- [x] analytics views (11: the 9 metric views + v_entities + v_school_days; frozen_now(), my_student_ids(), my_section_ids()) — written
- [x] roles + RLS (nologin roles, grants, policies per role, history policies on ops) — written
- [x] cron: `ops.redispatch()`, `ops.retention()`, Vault-backed secrets — written
- [x] `npx supabase login` → link → `npm run db:push` (all 7 applied 2026-10-22)
- [x] `npm run db:roles`: role passwords set, DATABASE_URL_APP/QUERY in .env, Vault secrets app_url + worker_secret
- Verify: 11 views with comments; query role without set_config → 0 rows; `cron.job` has `redispatch` and `retention`
- Note: security_invoker views require the query role to have SELECT on public base tables; RLS decides rows. The doc's "permission denied on public.passes" test becomes "same scoped rows as the view, never more".
- Note: `v_presence` and `v_device_uptime` read derived tables (`public.presence_events`, `public.device_hours`) written by the seed, because recomputing them per query (window over 800k taps, aggregate over 1.3M heartbeats) exceeded the 5s statement cap. In production the backend job that derives tap direction would maintain them. `analytics.frozen_now()` is evaluated once per statement in views (it is security definer, so Postgres cannot inline it). Since migration `20261023034510` the raw `taps` and `device_heartbeats` tables are not stored at all: the seed derives presence, entry and device-hour rows in memory and writes only those (plus passes and attendance). Handheld hallway checks and the card used per tap existed only in raw taps and were never reachable through a view.

### Phase 4: Seed (`packages/db/seed/`: rng, names, writer, config, stories, generate)
- [x] deterministic generator (`--seed`, `--scale`, `--no-stories`), two schools, 40 school days ending at frozen now 2026-10-13 10:40 (8 weeks, not 30 days: stories need 6 weeks of drift and 8 Tuesdays)
- [x] 13 planted stories as rules the generator consults (12 from the doc + the injection course fixture); `--no-stories` makes every rule neutral
- [x] determinism: two runs at scale 0.1 give identical counts and checksums
- [ ] full-scale load verified story by story (scratchpad verify-stories script)
- [ ] null-data run (`--no-stories`) recorded in README once the evals exist to measure it

### Phase 5: Authorization
- [ ] RLS policies per role on every fact table; dimension tables by school; history policy on ops.runs + run_entities
- [ ] persona context: `set_config` at transaction start on the query pool
- Verify: rls.teacher · rls.teacher_vs_teacher (A asks about B's section, B's overrides, a student only in B's class: zero rows; B's email: column unreadable) · rls.admin · rls.super · rls.noconfig · rls.bypass · rls.history · e2e.scope

### Phase 6: Observability
- [x] write points wired in `apps/web/src/lib/ops.ts` + `worker.ts` (runs, run_steps, run_results, run_output, run_entities, llm_calls, tool_calls); `current_node` after every node; liveness is a 30 s lease-renewal timer beside the run (`packages/agent/src/heartbeat.ts`, 2026-10-23)
- [x] `/ops` queries in `apps/web/src/lib/ops-queries.ts`, page at `/ops` — written
- Verify: one real run produces one row per node in run_steps, one per call in llm_calls, cost and tokens on runs

### Phase 7: Durability
- [x] `/api/ask` (budget, insert, ping), `/api/worker` (timing-safe secret, claim, `after()`, maxDuration 300), `/api/runs/[id]`, `/api/runs/[id]/feedback`, `/api/threads` — written, unverified (needs ANTHROPIC_API_KEY)
- [x] retryable vs non-retryable mapping; self-ping on requeue; chaos flag honoured when CHAOS_ENABLED — written
- [x] `scripts/ask.ts` end-to-end runs with the real key: scoped count, grouped table, clarification chips, section resolution, live tier-3 SQL, two-school comparison
- Verify: durability.resume · durability.redispatch · duplicate `run_id` is a no-op · over-budget returns 429 — all four pass against the real database (2026-10-23: `packages/agent/src/durability.dbtest.ts` with the scripted model, `apps/web/src/app/api/ask/route.dbtest.ts`); a chaos crash is now a `RetryableError`, so attempt 2 resumes from the checkpoint through the real queue path

### Phase 8: Memory
- [x] PostgresSaver (schema langgraph) on the app connection; messages trimmed to 10 turns; entity pinning in state; resume when the thread's latest checkpoint belongs to the same run — written
- [x] sketch node live; episode write after critic pass (score 1) or exhausted replans (-1); retrieval injected; feedback route updates score — written
- [x] naming a different student replaces the pin of that name (`pinEntity`, inherited pins only); chips re-ask their own card's question; verified live and by two graph tests (2026-10-23)
- Verify: pinned "Bart" persists across two runs in one thread and not across threads (graph tests); `EPISODES_ENABLED=false` yields zero retrievals and no episode row (durability.resume); thumbs up then two thumbs down takes an episode from score 1 to -2 and out of retrieval (`memory.feedback` in durability.dbtest, 2026-10-23)

### Phase 9: Evals
- [x] golden set: 90 cases, 30 per persona (every out-of-scope reason, tier 3, three history shapes, three injection cases, every registry metric at least once) in `packages/evals/golden/*.json`; each numeric expectation computed from the seed as the asking persona (2026-10-24)
- [x] runner `packages/evals/src/run.ts`: two passes (episodes off, on), plan/metric/viz/viz_metric/result/path/caveats/scope-row assertions, `--only <prefix>` (writes report-only.md), `--label`
- [x] run it: 84/90 off, 86/90 on, delta row in `packages/evals/report.md` (2026-10-24); the six distinct misses fixed and rerun green (session log 2026-10-23, golden-set section)
- [ ] null-data baseline with `--label no-stories`; CI on a seeded branch
- Verify: report produced; `--no-stories` pass shows nothing interesting

### Phase 10: Frontend
- [x] immediate local acknowledgment bubble on submit ("Got it, working on it"), replaced by polled status, then the answer — written
- [x] persona switcher (three exclusive toggles; switching starts a new thread) · thread list (eval threads hidden) · chat with polled status · answer card (react-markdown: raw HTML off, images and links removed) · VizRenderer (stat, line, bar, table, calendar via Recharts) · clarification chips · "What can I ask?" · thumbs · `/ops` — verified in a browser with a real question (calendar, caveats, SQL per step, thumbs)
- [x] README with run steps, "What tap data can and cannot tell you", known limits
- [x] reopening a thread shows its transcript (chip turns by label, unloadable runs say so, only a loaded unfinished run is polled); four reopen scenarios verified in the browser (2026-10-23)
- [x] run-detail page `/ops/runs/[id]` over the trace route (header, trail, every round with Request / Response / Meta tabs, tool calls under the round that asked, output), run ids on `/ops` and a Trace link on answer cards; 7 unit tests (2026-10-24)
- [x] grouped bars (series rule mirrored from facts.ts, legend, No-wing series in grey), names for id columns in charts and tables, percentages for rate steps, em dash for null cells, stored vote after reopen, thread-list loading state, Operations/Schema links, `/schema` page (views and notes from the planner's document, policies with what each qual means, column privileges and role settings); 20 unit tests; width × theme matrix handed to a verification agent (2026-10-24)
- [x] rebuilt as modular components (ui / viz / chat), IBM Plex, ink tokens with OS dark scheme, run trail on every card, native-dialog drawer on phones, native radio personas, calendar as a sequential heatmap, tables as labelled scroll regions; verified at 390/768/1360 light and dark with live runs for every viz type (session log 2026-10-22, frontend section)
- Verify: every definition-of-done bullet in design doc section 18

## Cases the design covers
- Scope: teacher / admin / super_admin enforced in Postgres; out-of-scope student → `permission` message, zero rows stored
- Ambiguity: ties resolved by code, never by the model; chips from lookup or from history ("this student")
- Six out-of-scope reasons with a useful redirect each
- Measured vs inferred: dwell, who-was-where, last-location, "who has left" carry caveats; device-offline windows checked before reading gaps as absences
- Failures: transient → retry; model mistake → one correction; unrecoverable → fail fast with a named error
- Dead worker → re-dispatch within a minute, resume from checkpoint without redoing nodes
- Double submit / double ping → one run, one worker
- Cost: monthly token budget (one env var, set high for now per Ritik), per-run cap, both visible in /ops
- PII: memory holds no names or rows; trace rows capped and expire; prompts never printed to logs; pseudonymization documented as the step before real data
- Prompt injection: model cannot widen access or act; structured output validated; renderer blocks images and external links; episode text handled as data (renderer + fixtures pending v1.2)
- History: what did I ask about this student, across threads, per user

## Doc additions applied in v1.2 (2026-10-24; each line below is now in `docs/ask-moov-design.md`, section 20 summarizes them)
- Renderer: no images, same-origin links only, raw HTML off
- Episode question text: capped, newline-stripped, delimited as data
- Planted story 13: a Shelbyville course named with an injection string; golden assertion that output is unaffected
- Three injection eval cases
- Derived tables: the demo database stores derived events only (`presence_events`, `entry_events`, `device_hours`); raw taps and heartbeats are generated by the seed and not stored. In production the ingest job that derives tap direction maintains these tables and the raw stream lives in the operational store. Also for v1.2: 240s run budget, planner answers in plain JSON, `students_at_location` metric.
- Run control: a 90 s deadline on every model call (the SDK timeout covers only response headers; `PER_CALL_TIMEOUT_MS`, `LlmTimeoutError` retryable), the run budget checked before every model call rather than only in `execute`. Liveness is a conventional lease renewal, not a side effect of progress: a 30 s timer beside the run (`HEARTBEAT_INTERVAL_MS`) writes `heartbeat_at` while the worker still holds the claim (`status = running` and the claimed `attempt`), stops at the run budget so a hung worker falls silent for the cron, and stops when the lease is lost; `current_node` is written per node for the UI only (design 2.1 step 6 and 9.1). 19 migrations.
- Compiler (design 4.6): range bounds are cast to the time column's own type (`::timestamptz` on the six timestamp views, `::date` on attendance and tardies). A cross-type `timestamptz >= date` comparison is not leakproof, and under RLS Postgres evaluates it only after the policy, so it could never be an index condition: the Gym count scanned 9292 rows for 2074 ms and timed out under load; same-type bounds reach the index (7 ms). `v_section_roster` has no compiler mapping (no time column, no metric); a metric pointing at an unmapped view is a `PlanValidationError`.
- Plan schema (design 4.3, 5): the planner's objects are `z.strictObject`. An unknown key (a hallucinated filter, a field from an older spec) is a parse error that gets the one corrective call, never a silent drop; 194 stored plans carried zero unknown keys, so this costs nothing.
- Episodic memory (design 11.2): templatize is one pass with all entity forms alternated longest first, and only a person is also matched by first name; "Room 214" no longer becomes `{{room}}` and the common noun "room" is left alone.
- Entity resolution (design 4.5a): honorifics are stripped before matching a person; for a two-word name, a candidate that scores only by trigram similarity (below the 0.9 a prefix or containment earns) must share the typed first name, so "Nelson Muntz" (0.500 against "Mia Nelson") is `none` and the planner says permission, while "Bart Simpsen" (0.625) still resolves. Rooms, sections, wings and schools are not names.
- Spec filters (design 4.4): every filter takes one value or a list; the compiler emits `= $n` for one and `= ANY($n)` for several. The planner writes `period: 6` as often as `[6]`, and a correction that says "expected array" makes it turn `destination` into a list too.
- History (design 14.1): compiled `my_history` returns one row per question (`string_agg` of entity labels), not one per resolved entity.
- Evals (design 12): 90 cases, 30 per persona; `caveats_include` assertion; a `--only` run writes `report-only.md`. Full run 2026-10-24: 84/90 off, 86/90 on, delta as measured.
- Critic and presenter inputs (design 4.8, 4.9): per step, up to 5 sample rows plus a facts block code computes over the full result (total where summable, highest and lowest rows, first and last of a series, top row per series, empty-dimension counts) and an entities block naming the plan's ids; ids in samples read "Name (id)". The presenter quotes numbers from steps, facts or samples only, may round to one decimal and write a rate as a percentage, never derives a number, and names exactly one visual.
- Shape `grouped` (two non-time group_by dimensions) draws as a grouped bar; caveat `no_wing_group` whenever wing is a dimension. Planner rule 4: a trend question with no date phrase spans the school year.
- Compiler (design 4.6): a filtered count (present, absent, override, no_card, temp) grouped by an entity adds `HAVING <count> > 0`, so "which students did X" lists only students who did; scalars, time series and calendars keep zeros. Full run on the facts-and-labels code: 89/90 off, 90/90 on (2026-10-24, `report.md`).
- Labels (design 13.4): `ops.run_output.labels` { column: { id: label } }, resolved through `analytics.v_entities` as the asking persona when the run completes; the UI draws names, the rows keep ids. `vote` on the run view carries the stored thumbs.
- Observability (design 9.1 "500-char excerpt" is replaced): every model round stores its full request (system blocks, messages, model parameters) and full response in `ops.llm_calls`; blocks over 2 KB are kept once by content hash in `ops.prompt_blocks`. Written without blocking the next round and settled before the run is marked finished. Transcripts expire after 7 days, the metrics stay. `GET /api/runs/[id]/trace` serves one run top to bottom for the run-detail page. 22 migrations.
- Two clocks: data lives on the frozen timeline and school days; history (`ops.runs`) is stamped in real time and spans every calendar day. `resolve_dates` takes `clock = history`; the planner rule 12 and the `history` domain note say so.
- Filter values: the enumerated filter values live once in `FILTER_VALUES` (shared), feed both the Spec schema and the registry text the planner reads, and are repeated as column comments on the views for tier-3 SQL (migration `20261023051304`).
- Operations: `ops.redispatch()` fails a run nobody claims within 10 minutes (design 2.1 step 10). Monthly budget counts `ops.llm_calls` for the UTC month, in-flight included (design 4.13). UI polls until the run row is terminal and reopening a thread loads its runs (design 13.2, 13.3). Critic rubric: an empty history result is the answer (design 4.8).
- calc (design 4.5 and the `calc.test` row): an undefined ratio or an empty list returns `value: null` plus an explanation that names the inputs (`change(0, 5)` is "from 0 to 5 (+5)", `rate(n, 0)`, `pct_of(p, 0)`, `avg([])`, `classes_to_target` with nothing scheduled, `expr` division by zero); `change(0, 0)` is 0 "no change"; a calc fed a null upstream value is null too. `CalcError` is for plan mistakes only.
- Presenter and VizSpec (design 4.9 and the `present` row in 4.1): `VizSpec.step` is the id of the plan step the chart is drawn from. The presenter names it from `answer_from` (an enum per run, enforced by the wrapper's Zod parse) after seeing each candidate's code-derived chart type, row count and columns; code checks `x.field` and `y.field` against that step's columns (`stat` exempt, `series` holds display labels), allows one corrective call, then fails with `VizValidationError`. The answer card and the episode shape read `viz.step`; the positional `answerStepId` survives only as the fallback for runs stored before it existed. Golden cases may assert `viz_metric`, the metric whose step must be charted (session log 2026-10-23).
- Clarification chips (design 13.5) carry the chosen entity by id: `/api/ask` accepts `pin`, `ops.runs.pins` stores it, the plan node seeds it into the thread's pinned entities before the planner runs. The transcript shows the chip's label as the user's turn. A chip with no entity (a vague metric) is still sent as text.
