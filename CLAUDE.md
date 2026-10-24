# Ask MOOV: rules for working in this repo

Spec: `docs/ask-moov-design.md` (the design, v1.2). Checklist: `docs/PLAN.md`. Session logs: `docs/sessions/YYYY-MM-DD.md`.

## What this is
An analytics agent over synthetic school tap data. The LLM fills in a typed plan; code compiles, validates, runs, and presents. Postgres RLS is the security boundary. The agent is the product; the data is the stage.

## Non-negotiable principles (from the spec, section 1)
1. LLM decides content, code decides control. The graph is fixed. The model never picks the next node.
2. Data scope is enforced in Postgres (RLS + security_invoker views + read-only role + set_config). Never in a prompt.
3. The LLM never does arithmetic. Rows → SQL. Scalars → `calc`.
4. The LLM writes SQL only in tier 3, and that SQL is parsed, allowlisted, and EXPLAINed before it runs.
5. Schema knowledge comes from migrations (views, COMMENT ON, domain_notes). No hand-maintained schema doc.
6. Every run is resumable and every step is recorded.
7. Say what was measured and what was inferred. Caveats are first-class.

## Engineering rules
- SoC: UI, API routes, graph, compiler, validator, DB clients are separate modules with one job each. Do not mix layers.
- KISS: build what the spec says, nothing speculative. No feature flags for things that do not exist yet.
- DRY: one metric registry, one compiler, one validator, one LLM wrapper. Reuse before adding.
- Fail fast and loud: throw typed errors; never swallow. Unknown ref, unknown metric, parse failure are errors, not warnings.
- CQS: functions either do something or return something.
- `@anthropic-ai/sdk` is imported in exactly one file: `packages/agent/src/llm.ts`.
- Migrations are plain SQL in `supabase/migrations/`, created with `npm run db:new` and applied with `npm run db:push`. Never edit an applied migration; add a new one. In scripts, run `supabase migration new` with `< /dev/null` (it blocks waiting on stdin otherwise) and `db push` with `yes |`.
- LangGraph: a node name may not equal a state field name. State fields are `sketch_key`, `plan_output`, `critic_verdict` for that reason.
- SQL reaches the database through exactly two paths: the compiler (tiers 1 and 2) and the validator-gated tier 3 step. Both run on the query pool.
- Never print prompts, rows, or questions to stdout. Trace goes to the `ops` tables only.
- Nothing is called "semantic memory". The curated facts are `domain_notes`. The stores are thread memory, domain notes, episodic memory.
- No webhooks, no Realtime, no vectors, no embeddings. Transport is a worker ping plus pg_cron re-dispatch; the UI polls.

## Before using a library API
Check current docs first (Context7 for Next.js, LangGraph.js, Anthropic SDK, Supabase; the claude-api skill for Claude API shapes). Do not write SDK calls from memory. Versions in use are pinned in the package.json files.

## Models
`claude-opus-5-5` for plan, critique, present. `claude-haiku-5-5` for sketch. Structured outputs via `client.messages.parse` + `zodOutputFormat`. No prefill. Adaptive thinking is the default.

## Commands
```
npm run dev                   Next.js dev server
npm test                      Vitest (packages/**/*.test.ts)
npm run db:new -- <name>      new migration file in supabase/migrations (Supabase CLI)
npm run db:push               apply pending migrations to the linked project
npm run db:reset              reset the linked project and re-apply every migration (destructive)
npm run db:roles              set passwords for ask_moov_app / ask_moov_query, write them to .env, store Vault secrets
npm run seed                  deterministic seed with stories
npm run seed -- --no-stories  null-data baseline
npm run evals                 golden set, two passes, writes evals/report.md
```

## Session routine
At the end of every session: write `docs/sessions/YYYY-MM-DD.md` with what was done, what is next, and open questions; tick the boxes in `docs/PLAN.md`; update the status line at the top of `docs/PLAN.md`.

## API constraints learned the hard way (2026-10-22)
- Structured outputs: no `$defs` under a union root, and every Zod `.describe()` becomes a `$ref`. Keep model-facing schemas free of `.describe()`; put field hints in the prompt.
- The planner's nested plan/step schema exceeds the compiled-grammar limit even without enums: the planner answers in plain JSON, parsed strictly in code (`formatSchema: null`), with one corrective call. The three small schemas keep `output_config.format`.
- `zodOutputFormat` (SDK 1.1.0) strips `enum` from the schema it sends and writes the allowed values into the field description; the wrapper's own Zod parse is what enforces every enum (`viz.type`, `viz.step`, sketch metrics). Treat an enum as a hint the model sees plus client-side validation plus one corrective call, never as constrained decoding.
- Nullable enums in tool schemas are `anyOf: [{type: "string", enum}, {type: "null"}]`, never `type: ["string", "null"]` with an enum. Tools are not strict (they share the grammar budget).
- `libpg-query` is in `serverExternalPackages`; Turbopack rewrites its .wasm path otherwise.
- Views over big derived tables must not join tiny RLS-protected lookup tables (planner estimates one row, nested-loop join filter); denormalize the lookup columns into the derived row.
- Clocks: this machine runs America/New_York (EDT); `ops.*` timestamps, `cron.job_run_details` and the Supabase logs are UTC. Match log lines to rows by run id or `thread_id` prefix (`eval-%`), never by a local-time window; the eval runner prints every run id and a UTC start time for this reason.
- Storage: the Supabase project is on the free plan (500 MB database quota on a 1 GB disk). Over the limit the platform flips the whole server read-only and every write fails with SQLSTATE 25006. Check `pg_database_size` before adding a table, an index or seed volume; raw taps and heartbeats are not stored for this reason (migration `20261023034510`).
