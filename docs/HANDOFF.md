# Ask MOOV: handoff (written 2026-10-24 01:10 UTC)

Spec: `docs/ask-moov-design.md` (v1.1; the v1.2 batch is listed at the bottom of `docs/PLAN.md` and waits on Ritik). Checklist and status: `docs/PLAN.md`. Narrative of every decision and gotcha: `docs/sessions/2026-10-22.md` and `docs/sessions/2026-10-23.md`. Rules for working here: `CLAUDE.md` (read its "API constraints learned the hard way").

## What exists and is verified
- Monorepo (npm workspaces): `packages/shared` (Zod schemas, 20-metric registry, personas), `packages/agent` (LangGraph graph sketch → plan → execute → critique → present; compiler, parser-based SQL validator, LLM wrapper, tools, episodes, heartbeat, runtime), `packages/db` (pools, ops data access, seed, role and Vault setup, authorization tests), `packages/evals` (90-case golden set, two-pass runner), `apps/web` (Next.js 16: `/api/ask`, `/api/worker`, `/api/runs/[id]`, `/api/runs/[id]/feedback`, `/api/threads`, `/api/threads/[id]`, chat UI, `/ops`).
- Supabase project `itfcbeculmlvhbcrkbgw` (us-east-1, Postgres 17), free plan: 21 migrations applied with the Supabase CLI. Database 368 MB (quota 500 MB; raw taps and heartbeats are generated in memory and not stored since 2026-10-23). Roles `ask_moov_app` and `ask_moov_query` with passwords in `.env` (gitignored). Vault holds `app_url` (still `http://localhost:3100`) and `worker_secret` for the pg_cron re-dispatch.
- Seed at full scale: 40 school days ending 2026-10-13 10:40, two schools, 13 planted stories, 129k passes, 499k attendance rows, 671k presence events, 64k entry events, 44k device hours. Deterministic.
- Run control: 90 s deadline on every model call (body included), run budget checked before every model round, lease-renewal heartbeat on a 30 s timer beside the run fenced to the claim and stopped at the run budget, per-run token cap spanning attempts, chaos crash as a retryable requeue that resumes from the checkpoint, `ops.redispatch()` fails a run nobody claims in 10 minutes, `ops.retention()` expires trace rows and the thread memory of threads idle for 30 days.
- Compiler: every time-range bound is cast to the column's own type, so the comparison is leakproof and reaches the index under row-level security (Gym count 2074 ms → 7 ms). Planner schemas are strict: an unknown key is a corrective call, never a silent drop.
- Presenter and critic (2026-10-24): per step they get a facts block code computes over the full result (total where summable, highest and lowest rows, first and last of a series, top row per series, empty-dimension counts), sample rows with ids as "Name (id)", and the plan's resolved entities. Two-dimension breakdowns compile to shape `grouped` (a grouped bar) with a wing caveat. Names for id columns are stored as `output.labels` and the stored thumbs as `vote` on `/api/runs/[id]`; the UI half (grouped bar, labels, em dash, rate formatting, loading state, vote, teacher chip) is with the frontend session.
- Tests: `npm test` 183 unit tests (no database, no key; includes validator, compiler snapshots, LLM wrapper, graph topology with chaos resume and pins, heartbeat, plan schema, refs, templatize, entity lookup, facts, labels, calc, dates, viz). `npm run test:db` 21 tests against the real database: authorization (14), durability (resume on attempt 2, redispatch, duplicate run_id), memory (two thumbs down remove an episode, retention), `/api/ask` (429 over budget, 400 malformed).
- Entity lookup: honorifics are stripped ("Ms. Krabappel" is Krabappel) and a two-word name that only resembles someone must share the first name (a teacher asking about "Nelson Muntz", who is outside her scope, used to get "Mia Nelson" back at similarity 0.500; typos such as "Bart Simpsen" at 0.625 still resolve). Every spec filter takes one value or a list and compiles to the same SQL. Compiled history is one row per question, not one per resolved entity.
- Verified live with the real key on 2026-10-24: Gym distinct students (compiled, 11 s), absences in Krabappel's 4th period (11), Room 214 offline minutes on Oct 6 (30), Lisa's classes to reach 98% (25, `classes_to_target`), the two-school comparison, "who is out right now" (31 rows) through the dev server.
- Evals: 90 golden cases (30 per persona), every numeric expectation computed by SQL against the seed as the asking persona before it was written. Full two-pass run 2026-10-24 00:53 to 01:50 UTC (`packages/evals/report.md`): 84/90 with episodes off, 86/90 on, replans 9% → 2%, tokens per question 25.5k → 24.3k, p50 latency 15.0 s → 14.3 s, $7.68 in total. The six distinct misses were two planner shape errors (`period: 6`, then an over-corrected `destination: ["bathroom"]`), a lookup that resolved "Nelson Muntz" to "Mia Nelson", a history list the critic refused for duplicate rows, and two expectations of mine that were too strict; all are fixed in code or in the case and each rerun passes (`report-only.md`). The run's own numbers were produced by the code before those fixes and are reported as measured. A `--only` run never overwrites `report.md`.

## How to run
```
npm install
npm run dev                      # http://localhost:3100 (3000 is taken on Ritik's machine); /ops for observability
npm test                         # unit
npm run test:db                  # authorization, durability, memory, route; real DB, no model calls, ~20 s
npm run seed                     # full reseed, ~3 min; `-- --no-stories` for the null-data baseline
npm run evals                    # two passes over 90 cases, ~1 h, ~$9 at tonight's averages; writes packages/evals/report.md
npm run evals -- --only <id-prefix>   # one case or a prefix, single pass, writes report-only.md
npm run db:vault -- <public-url> # after deploying: point the cron at the deployment (Vault app_url + worker_secret; touches no password)
npx tsx --env-file=.env scripts/ask.ts teacher "How many bathroom passes did Bart take this month?"   # one question end to end (dev server must be running)
npx tsx --env-file=.env scripts/schema-doc.ts   # the schema document the planner sees
```
`.env` must contain `DATABASE_URL_ADMIN`, `DATABASE_URL_APP`, `DATABASE_URL_QUERY`, `ANTHROPIC_API_KEY`, `APP_URL=http://localhost:3100`, `WORKER_SECRET`. See `.env.example`.

## Verification checklist (expected results)
1. `npm test` → 183 passed. `npm run test:db` → 21 passed. `npm run typecheck` clean. `npm run lint` no warnings. `npm run build` compiles (all API routes dynamic).
2. `scripts/ask.ts teacher "What's the attendance rate in my 4th period this month?"` → succeeded, compiled, stat ≈ 0.93, SQL shows `section_id IN (SELECT ... teacher_id = $4)` and `date >= $1::date`.
3. `scripts/ask.ts admin "How many passes did Bart take this month?"` → needs_clarification with two options (Bart Simpson, Bart Reyes); clicking a chip in the UI pins the chosen id.
4. `scripts/ask.ts admin "Who is out of class right now?"` → 31 rows, 2 with minutes > 20.
5. `scripts/ask.ts super_admin "Compare attendance rates between Springfield High and Shelbyville High this month"` → composed plan (two specs + calc), ≈0.921 vs ≈0.898.
6. As a teacher the model is never told who it is; permission answers come from empty lookups. `grep -n "scope_summary\|role" packages/agent/src/prompts.ts` shows no persona in any prompt.
7. SQL as `ask_moov_query` with no `set_config` returns 0 rows from every `analytics.*` view; `select email from public.teachers` is permission denied for every role.
8. While a run is in flight, `select heartbeat_at, current_node from ops.runs where id = ...` shows `heartbeat_at` advancing every 30 s whatever `current_node` says; after it finishes the row stops moving.
9. Browser: persona toggles, example chips, answer card with chart drawn from `viz.step`, caveats, SQL per step, thumbs, reopened threads with their transcript.

## Open issues
None known. Residual facts worth knowing:
- The query role's statement timeout is 5 s. Cold cache on this instance can push a school-wide `v_presence` scan past it; the compiler cast fix removed the known case. If a new one appears, EXPLAIN it as the persona through the view: the time column must be in the `Index Cond`.
- `/ops`, `/api/runs/[id]` and `/api/threads` are open. By decision: one user who switches persona; authorization is Postgres RLS, authentication is out of scope.
- Every run recorded before 2026-10-24 carries `git_sha deb75d9e` (the design-doc commit, the only one that existed); from the first push on, `git_sha` identifies the code that answered.
- Deploy readiness checked from the laptop on 2026-10-24: `npm run build` compiles; both app roles connect through the Supabase IPv4 session pooler (`<role>.<ref>@aws-0-us-east-1.pooler.supabase.com:5432`, the query role read-only); the parser's `.wasm` is traced into the worker bundle; Vercel Hobby with Fluid compute allows the worker route's `maxDuration = 300`. `.env.vercel` (gitignored) holds the production variables with the pooler hosts; `APP_URL` is filled in after the first deploy.

## Not done (by decision or not reached)
- Null-data baseline (`npm run seed -- --no-stories`, `npm run evals -- --label no-stories`, reseed with stories): two reseeds plus one pass, about 45 minutes and $4; needs Ritik's go because it replaces the seed twice.
- Design doc v1.2 batch: the list at the bottom of `docs/PLAN.md`, waiting on Ritik's go.
- CI on a seeded Supabase branch: branching is a paid feature; skipped.

## Deployed
- Repo: `https://github.com/Shoyo-Hin4ta/askMoov`, branch `main`. Vercel project `ask-moov` (Hobby, root directory `apps/web`, Next.js preset), production `https://ask-moov.vercel.app`, environment variables from `.env.vercel` (pooler hosts; the direct host is IPv6-only and fails on Vercel with `ENOTFOUND`). Vault `app_url` points at the deployment (`npm run db:vault`).
- Verified 2026-10-24 03:08 UTC: database routes 200; a question asked through the deployment ran on Vercel and succeeded in 12 s with `git_sha 7abfeb3`; a finished run requeued by hand with a stale `queued_at` was POSTed by `ops.redispatch()` at the next minute, Vercel answered 202, the worker claimed attempt 2 and succeeded in 8 s. Local `APP_URL` stays `http://localhost:3100`; only Vault and Vercel carry the public URL.
- A push to `main` deploys. Test files are excluded from the app's build-time type check (`apps/web/tsconfig.json`) and type-checked by `apps/web/tsconfig.test.json` in `npm run typecheck`.

## Gotchas that cost time (details in CLAUDE.md and the session logs)
- Supabase CLI `migration new` blocks on stdin in scripts (`< /dev/null`); `db push` wants `yes |`.
- Structured outputs: no `$defs` under a union root; `.describe()` creates `$ref`s; the planner's schema exceeds the grammar limit, so the planner answers in plain JSON parsed strictly in code with one corrective call. `zodOutputFormat` strips `enum` into the description; the wrapper's own Zod parse enforces it.
- The SDK's `timeout` covers only the response headers; the body is read with no timer unless a caller signal is passed (`AbortSignal.timeout` in the wrapper).
- Under RLS a non-leakproof operator (any cross-type comparison such as `timestamptz >= date`) is evaluated after the policy and can never use an index. Cast parameters to the column's own type.
- Turbopack: `libpg-query` must be in `serverExternalPackages`; relative imports in packages have no `.js` suffix.
- Views over big derived tables must not join tiny RLS-protected tables (nested loop); denormalize instead. `analytics.frozen_now()` is security definer and cannot be inlined; evaluate it once per statement.
- pg returns numeric/bigint as strings; parsers are set once in `packages/db/src/pools.ts`.
- The machine is in America/New_York; `ops.*` timestamps and Supabase logs are UTC. Match a log file to rows by `run_id` or `thread_id`, never by a clock window.
- The Supabase free plan puts the database in read-only mode (SQLSTATE 25006) over 500 MB; the 2026-10-22 eval crash was that, not code.
- Node 20 on this machine: Vitest pinned to 4.x.
