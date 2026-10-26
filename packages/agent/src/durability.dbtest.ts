import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { claimRun, closePools, enqueueRun, getAdminPool, getAppPool } from "@ask-moov/db";
import { personaFor } from "@ask-moov/shared";
import { retrieveEpisodes, voteEpisode, writeEpisode } from "./episodes";
import { fakeClient } from "./fakes";
import { executeRun, type RuntimeOptions } from "./runtime";

/**
 * Design 10 (durability) and 11 (memory) against the real database: the queue, the checkpointer, the cron function, the
 * episode store. The model is the scripted fake from fakes.ts, so these cost no tokens and are deterministic.
 * Every row written here carries an `eval-durability-` thread or a unique id and is deleted at the end of its test.
 */
const admin = getAdminPool();
const appQuery = async (sql: string, params: unknown[]) => (await getAppPool().query(sql, params)).rows;
afterAll(async () => { await admin.end(); await closePools(); });

/** One compiled step, no entity lookups: pass_count for the admin's school over a fixed range. */
function scriptedModel() {
  return fakeClient({
    sketch: [{ json: { metrics: ["pass_count"], entity_types: [], shape: "scalar" } }],
    plan: [{ json: { kind: "plan", steps: [{ id: "a", kind: "spec", spec: { metric: "pass_count", time_range: { start: "2026-10-01", end: "2026-10-13" } } }], answer_from: ["a"], expected_shape: "scalar" } }],
    critique: [{ json: { pass: true, reason: "counts passes in the range" } }],
    present: [{ json: { answer_md: "Passes counted.", viz: { type: "stat", title: "Passes", caveats: [], step: "a" } } }],
  });
}

async function deleteRun(id: string, threadId: string): Promise<void> {
  await admin.query("delete from ops.runs where id = $1", [id]); // cascades to run_steps, run_results, run_output, run_entities, llm_calls, tool_calls
  for (const t of ["checkpoint_writes", "checkpoint_blobs", "checkpoints"]) await admin.query(`delete from langgraph.${t} where thread_id = $1`, [threadId]);
}

describe("durability.resume", () => {
  it("a worker that dies after execute is requeued; attempt 2 resumes from the checkpoint without re-running sketch, plan or execute", async () => {
    const id = randomUUID();
    const threadId = `eval-durability-resume-${id.slice(0, 8)}`;
    const persona = { ...personaFor("admin"), chaos: { crash_after: "execute" } };
    const { client, calls } = scriptedModel();
    const options: RuntimeOptions = { runTokenCap: 150_000, episodesEnabled: false, chaosEnabled: true, gitSha: "dbtest", client, heartbeatMs: 5_000 };
    try {
      expect(await enqueueRun({ id, thread_id: threadId, persona, question: "How many passes were taken this month?", git_sha: "dbtest" })).toBe("inserted");

      const attempt1 = await claimRun(id);
      expect(attempt1?.attempt).toBe(1);
      expect(await executeRun(attempt1!, options)).toBeNull();
      const afterCrash = (await admin.query("select status, attempt, error from ops.runs where id = $1", [id])).rows[0]!;
      expect(afterCrash).toMatchObject({ status: "queued", attempt: 1 });
      expect(String(afterCrash["error"])).toMatch(/chaos/);

      const attempt2 = await claimRun(id);
      expect(attempt2?.attempt).toBe(2);
      const final = await executeRun(attempt2!, options);
      expect(final?.answer).toBe("Passes counted.");

      const run = (await admin.query("select status, attempt, error, episode_id, latency_ms from ops.runs where id = $1", [id])).rows[0]!;
      expect(run).toMatchObject({ status: "succeeded", attempt: 2, error: null, episode_id: null });
      expect(Number(run["latency_ms"])).toBeGreaterThan(0);

      const steps = Object.fromEntries((await admin.query("select node, count(*)::int as n from ops.run_steps where run_id = $1 group by node", [id])).rows.map((r) => [r["node"], r["n"]]));
      expect(steps).toEqual({ sketch: 1, plan: 1, execute: 1, critique: 1, present: 1 });
      expect(calls).toEqual({ sketch: 1, plan: 1, critique: 1, present: 1 });

      // episodes disabled: the plan step retrieved nothing and no episode was written
      const planStep = (await admin.query("select output_summary->>'episodes' as episodes from ops.run_steps where run_id = $1 and node = 'plan'", [id])).rows[0]!;
      expect(planStep["episodes"]).toBe("0");

      const result = (await admin.query("select row_count, rows from ops.run_results where run_id = $1 and step_id = 'a'", [id])).rows[0]!;
      expect(result["row_count"]).toBe(1);
      expect(typeof (result["rows"] as { value: unknown }[])[0]!.value).toBe("number");
      const output = (await admin.query("select answer_md, viz->>'step' as step from ops.run_output where run_id = $1", [id])).rows[0]!;
      expect(output).toEqual({ answer_md: "Passes counted.", step: "a" });
    } finally {
      await deleteRun(id, threadId);
    }
  });
});

describe("durability.redispatch", () => {
  it("ops.redispatch() requeues a stale worker, fails exhausted and unclaimed runs, and dispatches what is still queued", async () => {
    const thread = `eval-durability-redispatch-${randomUUID().slice(0, 8)}`;
    const persona = JSON.stringify(personaFor("admin"));
    const ids = { staleRunning: randomUUID(), staleRunningExhausted: randomUUID(), unclaimed: randomUUID(), queuedFresh: randomUUID(), queuedExhausted: randomUUID() };
    const insert = (id: string, status: string, attempt: number, queuedAgo: string, heartbeatAgo: string | null) =>
      admin.query(
        `insert into ops.runs (id, thread_id, persona, question, status, attempt, queued_at, claimed_at, heartbeat_at)
         values ($1, $2, $3, 'redispatch test', $4::ops.run_status, $5, now() - $6::interval, case when $7::text is null then null else now() - $7::interval end, case when $7::text is null then null else now() - $7::interval end)`,
        [id, thread, persona, status, attempt, queuedAgo, heartbeatAgo],
      );
    try {
      await insert(ids.staleRunning, "running", 1, "5 minutes", "3 minutes");
      await insert(ids.staleRunningExhausted, "running", 3, "5 minutes", "3 minutes");
      await insert(ids.unclaimed, "queued", 1, "11 minutes", null);
      await insert(ids.queuedFresh, "queued", 1, "2 minutes", null);
      await insert(ids.queuedExhausted, "queued", 3, "30 seconds", null);

      const dispatched = Number((await admin.query("select ops.redispatch() as n")).rows[0]!["n"]);
      expect(dispatched).toBeGreaterThanOrEqual(1);

      const rows = Object.fromEntries((await admin.query("select id, status, error, queued_at > now() - interval '1 minute' as requeued_now from ops.runs where thread_id = $1", [thread])).rows.map((r) => [r["id"], r]));
      expect(rows[ids.staleRunning]).toMatchObject({ status: "queued", requeued_now: true });
      expect(rows[ids.staleRunningExhausted]).toMatchObject({ status: "failed", error: "attempts exhausted: worker stopped heartbeating" });
      expect(rows[ids.unclaimed]).toMatchObject({ status: "failed", error: "not claimed within 10 minutes of being queued" });
      expect(rows[ids.queuedFresh]).toMatchObject({ status: "queued" });
      expect(rows[ids.queuedExhausted]).toMatchObject({ status: "failed", error: "attempts exhausted" });
    } finally {
      await admin.query("delete from ops.runs where thread_id = $1", [thread]);
    }
  });
});

describe("durability.idempotency", () => {
  it("a duplicate run_id is a no-op", async () => {
    const id = randomUUID();
    const threadId = `eval-durability-dup-${id.slice(0, 8)}`;
    try {
      const r = { id, thread_id: threadId, persona: personaFor("teacher"), question: "dup test", git_sha: "dbtest" };
      expect(await enqueueRun(r)).toBe("inserted");
      expect(await enqueueRun({ ...r, question: "a different question under the same id" })).toBe("duplicate");
      const row = (await admin.query("select count(*)::int as n, min(question) as q from ops.runs where id = $1", [id])).rows[0]!;
      expect(row).toEqual({ n: 1, q: "dup test" });
    } finally {
      await admin.query("delete from ops.runs where id = $1", [id]);
    }
  });
});

describe("memory.retention", () => {
  it("ops.retention() keeps a chat's memory and rows however old; an eval thread loses its memory a day after its run, a thread with no run at all loses it too", async () => {
    const tag = randomUUID().slice(0, 8);
    const threads = { chat: `t-retention-chat-${tag}`, evalOld: `eval-retention-old-${tag}`, evalFresh: `eval-retention-fresh-${tag}`, orphan: `eval-retention-orphan-${tag}` };
    const runs = { chat: randomUUID(), evalOld: randomUUID(), evalFresh: randomUUID() };
    const persona = JSON.stringify(personaFor("teacher"));
    const checkpoint = (thread: string) => admin.query("insert into langgraph.checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint) values ($1, '', 'cp-1', '{}'::jsonb)", [thread]);
    try {
      await admin.query("insert into ops.runs (id, thread_id, persona, question, status, created_at) values ($1, $2, $3, 'retention test', 'succeeded', now() - interval '400 days')", [runs.chat, threads.chat, persona]);
      await admin.query("insert into ops.runs (id, thread_id, persona, question, status, created_at) values ($1, $2, $3, 'retention test', 'succeeded', now() - interval '2 days')", [runs.evalOld, threads.evalOld, persona]);
      await admin.query("insert into ops.runs (id, thread_id, persona, question, status) values ($1, $2, $3, 'retention test', 'succeeded')", [runs.evalFresh, threads.evalFresh, persona]);
      await admin.query("insert into ops.run_results (run_id, step_id, columns, row_count, rows, created_at) values ($1, 'a', '[\"value\"]'::jsonb, 1, '[{\"value\": 1}]'::jsonb, now() - interval '400 days')", [runs.chat]);
      for (const t of Object.values(threads)) await checkpoint(t);
      for (const t of [threads.chat, threads.evalOld]) {
        await admin.query("insert into langgraph.checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, blob) values ($1, '', 'cp-1', 't', 0, 'c', '\\x00'::bytea)", [t]);
        await admin.query("insert into langgraph.checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob) values ($1, '', 'c', '1', 'json', '\\x00'::bytea)", [t]);
      }

      await admin.query("select ops.retention()");

      const left = async (table: string) => Object.fromEntries((await admin.query(`select thread_id, count(*)::int as n from langgraph.${table} where thread_id = any($1) group by thread_id`, [Object.values(threads)])).rows.map((r) => [r["thread_id"], r["n"]]));
      // the chat keeps its memory after more than a year; the day-old eval thread and the orphan lose theirs; the fresh eval thread keeps it until tomorrow
      expect(await left("checkpoints")).toEqual({ [threads.chat]: 1, [threads.evalFresh]: 1 });
      expect(await left("checkpoint_writes")).toEqual({ [threads.chat]: 1 });
      expect(await left("checkpoint_blobs")).toEqual({ [threads.chat]: 1 });
      // the chat's result rows and every run row stay
      expect(Number((await admin.query("select count(*) as n from ops.run_results where run_id = $1", [runs.chat])).rows[0]!["n"])).toBe(1);
      expect(Number((await admin.query("select count(*) as n from ops.runs where id = any($1)", [Object.values(runs)])).rows[0]!["n"])).toBe(3);
    } finally {
      await admin.query("delete from ops.runs where id = any($1)", [Object.values(runs)]);
      for (const t of ["checkpoint_writes", "checkpoint_blobs", "checkpoints"]) await admin.query(`delete from langgraph.${t} where thread_id = any($1)`, [Object.values(threads)]);
    }
  });
});

describe("memory.feedback", () => {
  it("two thumbs down take an episode out of retrieval", async () => {
    // a metric/shape/role combination no stored episode uses, so the ranked query has room for this one
    const sketch = { metrics: ["temp_id_count" as const], entity_types: [], shape: "entity_by_day" as const };
    const schemaVersion = `dbtest-${randomUUID().slice(0, 8)}`;
    const episodeId = await writeEpisode(appQuery, {
      role: "super_admin", questionTemplated: "durability vote test {student} {date_range}", shape: "entity_by_day", critique: { pass: true }, score: 1, schemaVersion, gitSha: "dbtest",
      plan: { kind: "plan", steps: [{ id: "a", kind: "spec", spec: { metric: "temp_id_count", entity: { type: "student", id: 1 }, time_range: { start: "2026-10-01", end: "2026-10-13" }, group_by: ["day"] } }], answer_from: ["a"], expected_shape: "entity_by_day" },
    });
    const retrieve = async () => (await retrieveEpisodes(appQuery, { sketch, role: "super_admin", questionTemplated: "durability vote test {student} {date_range}", schemaVersion })).map((e) => e.id);
    const score = async () => Number((await admin.query("select score from memory.episodes where id = $1", [episodeId])).rows[0]!["score"]);
    try {
      expect(await retrieve()).toContain(episodeId);
      await voteEpisode(appQuery, { episodeId, runId: randomUUID(), userId: 9001, vote: 1 });   // +1 -> 2
      expect(await score()).toBe(2);
      await voteEpisode(appQuery, { episodeId, runId: randomUUID(), userId: 9001, vote: -1 });  // -2 -> 0, still retrievable
      expect(await score()).toBe(0);
      expect(await retrieve()).toContain(episodeId);
      await voteEpisode(appQuery, { episodeId, runId: randomUUID(), userId: 9001, vote: -1 });  // -2 -> -2, gone
      expect(await score()).toBe(-2);
      expect(await retrieve()).not.toContain(episodeId);
      const votes = Number((await admin.query("select count(*) as n from memory.episode_feedback where episode_id = $1", [episodeId])).rows[0]!["n"]);
      expect(votes).toBe(3);
    } finally {
      await admin.query("delete from memory.episodes where id = $1", [episodeId]); // cascades to episode_feedback
    }
  });
});
