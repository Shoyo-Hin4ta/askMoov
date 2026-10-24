import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePools, getAdminPool, getRunTrace, insertLlmCall, type LlmCallRecord } from "./index";
import { blockHash } from "./transcript";
import { personaFor } from "@ask-moov/shared";

/** Transcript storage against the real database: blocks stored once, requests expanded on read, retention after 7 days. */
const admin = getAdminPool();
afterAll(async () => { await admin.end(); await closePools(); });

const bigBlock = `schema document ${"x".repeat(3000)}`;
const record = (over: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  node: "plan", model: "claude-opus-5-5", prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 0, latency_ms: 12, response_excerpt: "{}", error: null,
  request: { model: "claude-opus-5-5", max_tokens: 100, effort: "medium", format: false, tools: ["lookup_entity"], system: ["rules", bigBlock, "Now: 2026-10-13"], messages: [{ role: "user", content: "q" }] },
  response: [{ type: "text", text: "{\"kind\":\"plan\"}" }], stop_reason: "end_turn", ...over,
});

async function makeRun(): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into ops.runs (id, thread_id, persona, question, status) values ($1, $2, $3, 'transcript test', 'succeeded')", [id, `eval-transcript-${id.slice(0, 8)}`, JSON.stringify(personaFor("admin"))]);
  return id;
}

describe("transcripts", () => {
  it("stores the large block once, inlines small ones, and the trace reads the request back in full", async () => {
    const run = await makeRun();
    try {
      await insertLlmCall(run, record(), "dbtest");
      await insertLlmCall(run, record({ node: "critique" }), "dbtest");
      const hash = blockHash(bigBlock);
      const blocks = await admin.query("select count(*)::int as n from ops.prompt_blocks where hash = $1", [hash]);
      expect(blocks.rows[0]!["n"]).toBe(1);
      const stored = await admin.query("select request, block_hashes from ops.llm_calls where run_id = $1 order by id", [run]);
      expect(stored.rows).toHaveLength(2);
      expect(stored.rows[0]!["request"].system).toEqual([{ text: "rules" }, { hash, bytes: Buffer.byteLength(bigBlock) }, { text: "Now: 2026-10-13" }]);
      expect(stored.rows[0]!["block_hashes"]).toEqual([hash]);

      const trace = (await getRunTrace(run))!;
      const calls = trace["llm_calls"] as { node: string; request: { system: string[]; tools: string[] }; response: unknown; stop_reason: string }[];
      expect(calls.map((c) => c.node)).toEqual(["plan", "critique"]);
      expect(calls[0]!.request.system).toEqual(["rules", bigBlock, "Now: 2026-10-13"]);
      expect(calls[0]!.request.tools).toEqual(["lookup_entity"]);
      expect(calls[0]!.response).toEqual([{ type: "text", text: "{\"kind\":\"plan\"}" }]);
      expect(calls[0]!.stop_reason).toBe("end_turn");
      expect((trace["run"] as { id: string }).id).toBe(run);
    } finally {
      await admin.query("delete from ops.runs where id = $1", [run]);
      await admin.query("delete from ops.prompt_blocks where hash = $1", [blockHash(bigBlock)]);
    }
  });

  it("a failed round keeps its request and has no response", async () => {
    const run = await makeRun();
    try {
      await insertLlmCall(run, record({ error: "RateLimitError: boom", response: null, stop_reason: null, request: { ...record().request!, system: ["s"] } }), "dbtest");
      const row = (await admin.query("select request, response, stop_reason, error from ops.llm_calls where run_id = $1", [run])).rows[0]!;
      expect(row["request"].system).toEqual([{ text: "s" }]);
      expect(row["response"]).toBeNull();
      expect(row["error"]).toContain("boom");
    } finally {
      await admin.query("delete from ops.runs where id = $1", [run]);
    }
  });

  it("retention blanks request and response after 7 days and drops a block nobody referenced since, keeping the metrics", async () => {
    const run = await makeRun();
    const onlyHere = `old block ${"y".repeat(3000)} ${run}`;
    try {
      await insertLlmCall(run, record({ request: { ...record().request!, system: [onlyHere] } }), "dbtest");
      await admin.query("update ops.llm_calls set created_at = now() - interval '8 days' where run_id = $1", [run]);
      await admin.query("select ops.retention()");
      const row = (await admin.query("select request, response, prompt_tokens, latency_ms from ops.llm_calls where run_id = $1", [run])).rows[0]!;
      expect(row["request"]).toBeNull();
      expect(row["response"]).toBeNull();
      expect(row["prompt_tokens"]).toBe(10);
      expect(row["latency_ms"]).toBe(12);
      const gone = await admin.query("select count(*)::int as n from ops.prompt_blocks where hash = $1", [blockHash(onlyHere)]);
      expect(gone.rows[0]!["n"]).toBe(0);
      const trace = (await getRunTrace(run))!;
      expect((trace["llm_calls"] as { request: unknown }[])[0]!.request).toBeNull();
    } finally {
      await admin.query("delete from ops.runs where id = $1", [run]);
      await admin.query("delete from ops.prompt_blocks where hash = $1", [blockHash(onlyHere)]);
    }
  });
});
