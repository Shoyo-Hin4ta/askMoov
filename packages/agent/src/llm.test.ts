import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Llm, type LlmClient, type LlmCallRecord } from "./llm";
import { BudgetExceededError, LlmParseError, LlmRefusedError, LlmRequestError, LlmTimeoutError, LlmTruncatedError, RetryableError, RunBudgetError } from "./errors";

const Schema = z.object({ answer: z.number() });

function message(over: Partial<Anthropic.Message> & { text?: string }): Anthropic.Message {
  const { text = JSON.stringify({ answer: 4 }), ...rest } = over;
  return {
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn", stop_sequence: null, stop_details: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null, service_tier: null, cache_creation: null, inference_geo: null, iterations: null, speed: null },
    ...rest,
  } as unknown as Anthropic.Message;
}

function sdkError(cls: { prototype: object }, props: Record<string, unknown>): Error {
  return Object.assign(Object.create(cls.prototype), { message: "boom", ...props }) as Error;
}

function llmWith(reply: () => Promise<Anthropic.Message>, cap = 1_000_000) {
  const records: LlmCallRecord[] = [];
  const client: LlmClient = { messages: { create: vi.fn(reply) } };
  const llm = new Llm(client, { runTokenCap: cap, onCall: (r) => { records.push(r); } });
  const call = () => llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }] });
  return { llm, call, records, client };
}

describe("llm wrapper", () => {
  it("returns parsed output and records usage", async () => {
    const { call, records, llm } = llmWith(async () => message({}));
    const out = await call();
    expect(out.output).toEqual({ answer: 4 });
    expect(llm.tokensUsed).toBe(120);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ node: "plan", prompt_tokens: 100, completion_tokens: 20, error: null });
  });

  it("refusal -> LlmRefusedError, recorded", async () => {
    const { call, records } = llmWith(async () => message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } as never, text: "" }));
    await expect(call()).rejects.toBeInstanceOf(LlmRefusedError);
    expect(records[0]?.error).toContain("cyber");
  });

  it("max_tokens -> LlmTruncatedError before any parse attempt", async () => {
    const { call } = llmWith(async () => message({ stop_reason: "max_tokens", text: '{"answer": 4' }));
    await expect(call()).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("unparseable or schema-invalid output -> LlmParseError", async () => {
    await expect(llmWith(async () => message({ text: "not json" })).call()).rejects.toBeInstanceOf(LlmParseError);
    await expect(llmWith(async () => message({ text: '{"answer":"four"}' })).call()).rejects.toBeInstanceOf(LlmParseError);
  });

  it("token cap -> BudgetExceededError", async () => {
    const { call } = llmWith(async () => message({}), 100);
    await expect(call()).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it.each([
    ["RateLimitError", Anthropic.RateLimitError, { status: 429 }],
    ["InternalServerError (529 overloaded)", Anthropic.InternalServerError, { status: 529 }],
    ["APIConnectionTimeoutError", Anthropic.APIConnectionTimeoutError, {}],
  ])("%s -> RetryableError, recorded with error", async (_n, cls, props) => {
    const { call, records } = llmWith(async () => { throw sdkError(cls as never, props); });
    await expect(call()).rejects.toBeInstanceOf(RetryableError);
    expect(records[0]?.error).toContain("boom");
  });

  it("exhausted run budget -> RunBudgetError before any request is sent", async () => {
    const { llm, client } = llmWith(async () => message({}));
    const call = llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }], budget: { started_at: Date.now() - 1_000, total_ms: 500 } });
    await expect(call).rejects.toBeInstanceOf(RunBudgetError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  /** A client whose response never arrives until the caller's signal aborts it, the way a stalled body read behaves. */
  function stalledClient(): LlmClient {
    return { messages: { create: vi.fn((_p: unknown, opts?: { signal?: AbortSignal }) => new Promise<Anthropic.Message>((_, reject) => {
      opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
    })) } };
  }

  it("a stalled response is cut at the per-call deadline -> LlmTimeoutError, retryable, recorded", async () => {
    const records: LlmCallRecord[] = [];
    const llm = new Llm(stalledClient(), { runTokenCap: 1_000_000, perCallTimeoutMs: 20, onCall: (r) => { records.push(r); } });
    const err = await llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmTimeoutError);
    expect((err as LlmTimeoutError).retryable).toBe(true);
    expect(records[0]?.error).toContain("deadline 20ms");
  });

  it("the per-call deadline never exceeds the remaining run budget", async () => {
    const llm = new Llm(stalledClient(), { runTokenCap: 1_000_000, perCallTimeoutMs: 60_000 });
    const t0 = Date.now();
    await expect(llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }], budget: { started_at: t0, total_ms: 30 } })).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("400 -> LlmRequestError, not retryable", async () => {
    const { call } = llmWith(async () => { throw sdkError(Anthropic.BadRequestError as never, { status: 400 }); });
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmRequestError);
    expect(err.retryable).toBe(false);
  });
});

describe("llm wrapper: the token cap spans attempts", () => {
  it("a run that already spent its cap on earlier attempts fails on the first call of the next one", async () => {
    const records: LlmCallRecord[] = [];
    const client: LlmClient = { messages: { create: vi.fn(async () => message({})) } };
    const llm = new Llm(client, { runTokenCap: 1_000, usedTokens: 950, onCall: (r) => { records.push(r); } });
    expect(llm.tokensUsed).toBe(950);
    await expect(llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }] })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(llm.tokensUsed).toBe(1_070); // the one round it did make is counted and recorded
    expect(records[0]?.error).toMatch(/token cap/);
  });
});

describe("llm wrapper: the transcript", () => {
  it("records exactly what was sent and the full content that came back", async () => {
    const records: LlmCallRecord[] = [];
    const client: LlmClient = { messages: { create: vi.fn(async () => message({ text: JSON.stringify({ answer: 4 }) })) } };
    const llm = new Llm(client, { runTokenCap: 1_000_000, onCall: (r) => { records.push(r); } });
    await llm.callStructured({ node: "critique", model: "claude-opus-5-5", schema: Schema, system: [{ type: "text", text: "rules" }, { type: "text", text: "schema doc" }], messages: [{ role: "user", content: "q" }], effort: "low", max_tokens: 123 });
    const r = records[0]!;
    expect(r.request).toEqual({ model: "claude-opus-5-5", max_tokens: 123, effort: "low", format: true, tools: null, system: ["rules", "schema doc"], messages: [{ role: "user", content: "q" }] });
    expect(r.response).toEqual([{ type: "text", text: JSON.stringify({ answer: 4 }), citations: null }]);
    expect(r.stop_reason).toBe("end_turn");
  });

  it("a failed call still records the request, with no response", async () => {
    const records: LlmCallRecord[] = [];
    const client: LlmClient = { messages: { create: vi.fn(async () => { throw sdkError(Anthropic.RateLimitError, { status: 429 }); }) } };
    const llm = new Llm(client, { runTokenCap: 1_000_000, onCall: (r) => { records.push(r); } });
    await expect(llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }] })).rejects.toBeInstanceOf(RetryableError);
    expect(records[0]!.request).toMatchObject({ system: ["s"], format: true, tools: null });
    expect(records[0]!.response).toBeNull();
    expect(records[0]!.stop_reason).toBeNull();
  });

  it("the tool round's request carries the messages as they stood, and the next round's carries the tool results", async () => {
    const records: LlmCallRecord[] = [];
    const replies = [
      message({ content: [{ type: "tool_use", id: "tu_1", name: "lookup_entity", input: { type: "student", text: "Bart" } }], stop_reason: "tool_use" } as never),
      message({}),
    ];
    const client: LlmClient = { messages: { create: vi.fn(async () => replies.shift()!) } };
    const llm = new Llm(client, { runTokenCap: 1_000_000, onCall: (r) => { records.push(r); } });
    await llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }], tools: [{ name: "lookup_entity", input_schema: { type: "object" } }], onToolUse: async () => ({ id: 1203 }) });
    expect(records).toHaveLength(2);
    expect(records[0]!.request!.tools).toEqual(["lookup_entity"]);
    expect(records[0]!.request!.messages).toHaveLength(1);
    expect(records[1]!.request!.messages).toHaveLength(3); // user, assistant tool_use, user tool_result
    expect(records[0]!.stop_reason).toBe("tool_use");
  });

  it("a parse error after a tool round carries what the failing round was sent and the rejected text", async () => {
    const replies = [
      message({ content: [{ type: "tool_use", id: "tu_1", name: "lookup_entity", input: { type: "student", text: "Bart" } }], stop_reason: "tool_use" } as never),
      message({ text: '{"answer":"four"}' }),
    ];
    const client: LlmClient = { messages: { create: vi.fn(async () => replies.shift()!) } };
    const llm = new Llm(client, { runTokenCap: 1_000_000 });
    const err = await llm.callStructured({ node: "plan", model: "claude-opus-5-5", schema: Schema, system: "s", messages: [{ role: "user", content: "q" }], tools: [{ name: "lookup_entity", input_schema: { type: "object" } }], onToolUse: async () => ({ id: 1203 }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmParseError);
    const parse = err as LlmParseError;
    expect(parse.transcript.map((m) => m.role)).toEqual(["user", "assistant", "user"]); // question, tool_use, tool_result
    expect(parse.reply).toBe('{"answer":"four"}');
  });
});
