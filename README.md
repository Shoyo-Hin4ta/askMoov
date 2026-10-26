# Ask MOOV

An analytics agent over school ID-card tap data. A teacher, building admin or district admin asks a question in plain English and gets an answer, a chart, the caveats, and the SQL that produced it, scoped to exactly the data their role may see.

The model fills in a typed plan. Code compiles it, validates it, runs it and presents it. A second model pass checks the results against the question, and code checks that every number in the written answer is one the results produced before anyone sees it. Postgres row-level security is the only authorization. Design: `docs/ask-moov-design.md`. Status and checklist: `docs/PLAN.md`.

## Run it

```
cp .env.example .env            # fill DATABASE_URL_ADMIN, ANTHROPIC_API_KEY, WORKER_SECRET, APP_URL
npm install
npx supabase login && npx supabase link --project-ref <ref>
npm run db:push                 # 26 migrations: domain, ops, memory, langgraph, views, roles + RLS, cron, run_output, derived tables, view fixes, drop raw event tables, redispatch cap, pins, retention, run_output labels, model-call transcripts, episode cleanup, ops list indexes, chats kept for good
npm run db:roles                # role passwords -> .env, Vault secrets for the cron
npm run db:vault -- <url>       # after deploying: point the cron re-dispatch at the public URL (writes Vault app_url + worker_secret, touches no password)
npm run seed                    # two schools, 40 school days, 13 planted stories (~3 min)
npm run dev                     # http://localhost:3100  (/ops for observability)
npm test                        # unit tests, no database
npm run test:db                 # authorization, durability, memory and route tests against the seeded database (no model calls)
npm run evals                   # golden set, twice (episodes off, on) -> packages/evals/report.md; `-- --only <id-prefix>` runs a subset and writes report-only.md instead
```

Ask one question from a terminal: `npx tsx --env-file=.env scripts/ask.ts teacher "How many bathroom passes did Bart take this month?"`

## What tap data can and cannot tell you

Everything here is derived from card taps on readers, kiosks and handhelds. That gives a precise record of **where a card was** at a moment. It does not give:

- **Who held the card.** A tap proves the card was presented, not that its owner presented it. Questions like "is Bart sharing his card" are refused as identity questions; the agent can show overlapping passes instead.
- **When a student left a room.** This school has no exit kiosk. A departure is inferred from the next tap somewhere else or the end of the day, so time at a location is an upper bound. Every such number carries the caveat `inferred from next tap`.
- **Where a bathroom pass went.** Bathroom passes have no destination tap. The destination is assumed.
- **Anything while a reader was offline.** Missing taps during an outage are missing data, not absences. The device-uptime view exists so the agent can check before reading a gap as an absence (Room 214 on October 6 and 8 in the seed).
- **Why a teacher overrode attendance.** A manual absent after a tap means the teacher did not see the student in the room. The data records the contradiction, not the reason.
- **Grades, discipline, health, or anything outside taps, passes, attendance and devices.**

The agent says which of its numbers are measured and which are inferred, and shows the SQL for every answer.

## Budgets

Two numbers, both plain environment variables, both visible on `/ops`:

- `MONTHLY_TOKEN_BUDGET` (50,000,000 now). Before a run is created, `/api/ask` sums every model call recorded this calendar month (UTC) in `ops.llm_calls`: prompt tokens (input, cache reads and cache writes all count as one) plus completion tokens, across all personas, including runs still in flight and runs that died before finishing. At or over the budget the request gets a 429 with the numbers, nothing is run, and the chat shows the message. The counter resets on the first of the month. A question averages about 25,600 tokens and $0.05 at the current mix, so 50,000,000 is roughly 1,950 questions or $100; one in-flight run can overshoot the line by its own size, at most about 90,000 tokens so far.
- `RUN_TOKEN_CAP` (150,000). Checked after every model call inside a run; crossing it fails the run with `BudgetExceededError` in `runs.error`.

## Known limits of this demo

- No login. The browser picks one of three personas by key; the server maps the key to a real `(role, user_id, school_id)` and the database enforces it. A real deployment derives the persona from a verified session.
- `/ops` and `/api/runs/[id]/trace` are unauthenticated and show questions, prompts and trace data (full transcripts are kept for 7 days).
- Names and result rows reach the model inside scoped prompts and stay in the trace tables with the chat (the full prompt and response text of each model call expires after 7 days; answers, rows and conversation memory are kept). The step before real student data is pseudonymizing entities before the model call (ids in, names substituted back by code) and a data agreement with the model vendor.
- Teacher emails are unreadable by the query role at the column level; nothing else personal exists in the data beyond names, grades, locations and card status, all scoped by role.
- The database stores derived events only: arrivals with their inferred departures, entrance events, device uptime per hour, passes, attendance. Raw taps and device heartbeats are generated by the seed in memory and not stored, which is also the production shape (the ingest job derives, the agent reads derived tables). Hallway handheld checks and the card used for a given tap exist only in the raw stream and are not answerable.
