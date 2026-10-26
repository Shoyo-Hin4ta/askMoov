# Ask MOOV

An analytics agent over school ID-card tap data. A teacher, a principal or a district admin asks a question in plain English. They get an answer, a chart, the caveats and the SQL that produced it, limited to the data their role may see.

The model plans the query and writes the answer. Code does everything that touches the data. This README says how a question moves through the system, who can see what, and what the agent remembers. It also says what is kept and for how long, how the model is kept in its lane, how every run is recorded, and what happens when a worker dies. The design is in `docs/ask-moov-design.md`, the checklist and status in `docs/PLAN.md`, the session logs in `docs/sessions/`.

## How a question flows

1. The browser posts the question to `/api/ask` with a run id it generated itself. The same id twice is a no-op, so a double click cannot start two runs. The route checks the monthly token budget, inserts the run as queued, pings the worker and answers at once with a 202.
2. `/api/worker` checks a shared secret with a constant-time compare, then claims the run with one UPDATE that only succeeds while the run is still queued. That UPDATE is the lock: when the ping and the cron both arrive, one of them gets the run. The worker answers 202 and runs the graph after the response, inside Vercel's 300 second window.
3. The graph is fixed: sketch, plan, execute, critique, present. The model fills in content at four of those steps and never chooses the next one.
   - Sketch (Haiku) turns the question into a small key, the metrics and result shape it probably needs. The key is used only to look up past plans.
   - Plan (Opus) resolves names and dates through two tools, reads up to three past plans that worked, and returns a typed plan of up to four steps. A step is a registry metric with filters and a date range, a small calculation over earlier steps, or, when no metric fits, a SQL statement with the reason. Code validates the plan and compiles every metric step before anything runs. A plan that fails validation gets one corrective call with the error attached.
   - Execute runs one step per visit. A metric step compiles to parameterized SQL. A SQL step is parsed with the real Postgres parser, restricted to the analytics views and an allowlist of functions, given a LIMIT, and EXPLAINed on the scoped connection before it runs. Arithmetic over earlier results goes through a `calc` tool. The model never does it.
   - Critique (Opus) sees the question, the plan, each step's SQL, five sample rows and a facts block that code computed over the full result. It passes, or sends the plan back with a reason. At most two replans.
   - Present (Opus) writes the answer and names the step the chart is drawn from. Code checks that the chart can be drawn from that step, and that every number in the text is a rounding of a number the writer was shown. A miss gets a corrective call that names the number. The chart check allows one correction, the number check two, then the run fails with a named error rather than ship a wrong figure.
4. The browser polls the run once a second and renders the answer, the chart, the caveats, the SQL per step and a link to the full trace.

Names are resolved by code, not by the model. One clear match is used. A tie becomes a clarification with chips, and a chip carries the chosen id back, so the next run pins it instead of guessing. Pins last for the conversation: Bart means the same Bart until a different one is named.

## Who can see what

Authorization lives in Postgres, never in a prompt.

- Every query the agent runs goes through views in the `analytics` schema that are `security_invoker`, so row-level security on the base tables applies to whoever is asking. A teacher sees students on her rosters and her own sections. A principal sees their school. A district admin sees both schools. 35 policies, one set per role on every table.
- The agent's database role can only SELECT. Each query runs inside a read-only transaction with a five second statement timeout, and the first statement of that transaction sets the caller's role, user id and school id as session settings. Without them every view returns zero rows.
- Teacher email addresses are unreadable by that role at the column level.
- The planner, critic and writer are never told who is asking. A question about a student outside the asker's scope gets the answer that the student is not available, because the lookup found nothing, not because a prompt said so.
- The compiler adds the scope as a predicate to the SQL it writes, so the SQL shown to the reader is honest even though RLS is the guarantee.
- 24 tests run against the real database and check this role by role, including two teachers who cannot see each other's sections, overrides or students.

There is no login in this demo. The browser picks one of three personas and the server maps that key to a real role, user id and school id in one function. A verified session would plug in there, and nothing below it would change.

## Three kinds of memory

Nothing here uses vectors or embeddings.

- Conversation memory. Every node writes a checkpoint, so a run that dies resumes where it stopped. The pinned names, the resolved dates and the last ten turns carry across the questions in a chat. Reopening a chat brings its pins back.
- Domain notes. Fourteen curated facts about tap data, loaded into the planner prompt. A classroom tap has no direction of its own, a bathroom pass has no destination tap, a reader outage means missing data rather than absences. They change only by migration. The agent never writes them.
- Episodic memory. When the critic passes a plan, the plan is stored with its question templated: names become `{student}` or `{section}`, dates become `{date_range}`. The next planner that asks something with the same metrics and shape sees up to three of these as data. Thumbs up adds one to a plan's score, thumbs down subtracts two, and a plan below zero is no longer retrieved. No name, no result row and no free text from the critic is stored; the stored critique is the verdict only. On the golden set, memory on took the pass rate from 89 of 90 to 90 of 90 and cut replans.

History is not memory. A user can ask what they asked about a student before. That is a view over their own past runs, protected by the same row-level security, and the agent treats it as recall, not as evidence.

## What is kept and for how long

- Chats are kept for good: the questions, the answers, the result rows, the tool calls and the conversation memory. Nothing a person did in a chat expires.
- The full text of every model call, the prompt as sent and the reply as received, is kept for seven days so a bad answer can be read back. After that the tokens, latency, cost and error stay.
- The conversation memory of eval runs expires a day after the run. Those threads are never reopened.
- The seeded database stores derived events only: arrivals with their inferred departures, entrance taps, device uptime per hour, passes and attendance. Raw taps are generated in memory and never stored, which is also the production shape.

## Keeping the model in its lane

Student names, course titles and past questions reach the model as data, and data can contain text that looks like an instruction. The system is built so that what the text says does not matter much.

- The model cannot choose a node, run a query, write a row or widen its scope. It fills in typed outputs that code validates. Every object in the plan schema is strict: an unknown field is a parse error, never a silent drop.
- SQL the model writes is parsed, not pattern matched. Only `analytics.*` relations and an allowlist of functions pass, and the statement runs on a read-only role with a timeout.
- Every block of data in a prompt is delimited and labelled as data, including tool results and the past plans from memory.
- Every number in the written answer must come from the results. A sentence that smuggles in a figure fails the number check.
- The answer is rendered with raw HTML off and images, links, iframes and scripts stripped.
- The seed plants a course whose title tells the reader to report attendance as 100%, and four golden cases ask questions that cross it. The answers are unaffected.
- The worker only accepts a request with the right secret. Two budgets bound spend: a monthly token budget checked before a run starts and a per-run cap checked after every model call.

## Observability

Every run leaves a full trace in Postgres, and the pages that read it are part of the app.

- `ops.runs` holds the run: status, attempt, current node, latency, tokens, cost, the git sha that answered, the error if any.
- `ops.run_steps` has one row per node per attempt. `ops.llm_calls` has one row per model round with the full request and response; prompt blocks over 2 KB are stored once by content hash. `ops.tool_calls`, `ops.run_results` and `ops.run_output` hold the tool calls, the rows per step, and the answer with its chart spec, caveats and plan.
- `/ops` shows latency percentiles, the failure, tier-3 and replan rates, cost and tokens per day, the cache hit ratio and month-to-date spend. It also shows runs in flight with their heartbeat age, failures by node, episode counts and votes, and runs by git sha.
- `/ops/runs` lists every run with filters. `/ops/calls` lists every model call and opens the round it belongs to. `/ops/runs/[id]` shows one run top to bottom: the trail, every round's prompt and reply, the tool calls under the round that made them, the rows per step, the output.
- `/schema` shows what the planner reads, the views with their comments and the domain notes, plus the policies, column grants and role settings, all read from the catalog at request time.

## The worker, the heartbeat, and what happens when things die

- Liveness is a lease. While the worker holds a run, a timer renews a heartbeat every 30 seconds, but only while the run is still marked running on the attempt it claimed. A worker that lost its run to another one goes quiet. The timer also stops at the run's 240 second budget, so a worker that is alive but stuck falls silent on purpose.
- A pg_cron job runs every minute inside the database. A running run with no heartbeat for two minutes goes back to the queue, or fails after three attempts. A queued run nobody claims for ten minutes fails. Every run queued for more than a minute is posted to the worker again through pg_net. No webhook, no external queue.
- A resumed attempt starts from the last checkpoint, so finished nodes do not run again. A chaos flag crashes the worker after a chosen node on the first attempt, and the test proves attempt two finishes with every node run once.
- Errors are typed. Rate limits, overloads, connection drops and timeouts are retryable and requeue the run. A refusal, a truncated reply, unparseable output, a budget overrun or an exhausted correction fails the run fast, with the error class in the run row.
- Every model call has a 90 second deadline that covers the response body. Every SQL statement has five seconds, every run 240 seconds, and a token cap that spans attempts.
- On Vercel the app connects through Supabase's transaction pooler with small pools that release idle connections. Four simultaneous questions once exhausted the session pooler, and six at once now succeed.

## Evals

91 golden cases, 30 or 31 per persona. Every expected number was computed from the seed as that persona before the case was written. The runner calls the same runtime the worker uses, twice: with episodic memory off, then on with what the first pass stored. The latest full run was on October 24, with 90 cases at the time. It passed 89 of 90 with memory off and 90 of 90 with it on, and the one miss was traced to a compiler rule that was then fixed. The report with every run id is `packages/evals/report.md`.

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
- `/ops`, `/ops/runs`, `/ops/calls` and the trace pages are unauthenticated and show questions, prompts and trace data. The full prompt text of each model call expires after seven days.
- Names and result rows reach the model inside scoped prompts and stay in the trace tables with the chat. The step before real student data is pseudonymizing entities before the model call (ids in, names substituted back by code) and a data agreement with the model vendor.
- Teacher emails are unreadable by the query role at the column level; nothing else personal exists in the data beyond names, grades, locations and card status, all scoped by role.
- The number check reads digits, not words. A number written as a word is not checked, and a small integer that also appears in a date can pass when it should not.
- The history view counts eval runs, so a persona who never asked about a student in the chat can still be offered that student as a chip.
- The database stores derived events only: arrivals with their inferred departures, entrance events, device uptime per hour, passes, attendance. Raw taps and device heartbeats are generated by the seed in memory and not stored, which is also the production shape (the ingest job derives, the agent reads derived tables). Hallway handheld checks and the card used for a given tap exist only in the raw stream and are not answerable.
