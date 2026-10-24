import { describe, expect, it } from "vitest";
import { attachToolCalls, dedupeSystemBlocks, formatUsd, requestState, responseState, stableStringify, type LlmRound, type ToolCallRow } from "./trace";

const round = (over: Partial<LlmRound>): LlmRound => ({
  id: 1, node: "plan", model: "claude-opus-5-5", prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 0, latency_ms: 100, error: null, stop_reason: "end_turn",
  request: { model: "m", max_tokens: 1, effort: "low", format: false, tools: null, system: ["S"], messages: [] }, response: [{ type: "text", text: "ok" }], created_at: "2026-10-24T05:48:13.000Z",
  ...over,
});

describe("attachToolCalls", () => {
  it("attaches a call to the round that asked for it, regardless of timestamps and key order", () => {
    const rounds = [
      round({ id: 1, created_at: "2026-10-24T05:48:20.000Z", response: [{ type: "tool_use", name: "resolve_dates", input: { phrase: "this month", kind: "relative" } }] }),
      round({ id: 2, created_at: "2026-10-24T05:48:30.000Z" }),
    ];
    const tools: ToolCallRow[] = [{ node: "plan", tool: "resolve_dates", args: { kind: "relative", phrase: "this month" }, result: {}, duration_ms: 5, created_at: "2026-10-24T05:48:18.000Z" }];
    const { rounds: out, unmatched } = attachToolCalls(rounds, tools);
    expect(out[0]!.tools).toEqual([{ call: tools[0], matched: true }]);
    expect(out[1]!.tools).toEqual([]);
    expect(unmatched).toEqual([]);
  });
  it("a call no round asked for lands after the nearest earlier round, unmatched", () => {
    const rounds = [round({ id: 1, created_at: "2026-10-24T05:48:20.000Z" }), round({ id: 2, created_at: "2026-10-24T05:48:30.000Z" })];
    const tools: ToolCallRow[] = [{ node: "plan", tool: "lookup_entity", args: { text: "Bart" }, result: {}, duration_ms: 5, created_at: "2026-10-24T05:48:25.000Z" }];
    const { rounds: out } = attachToolCalls(rounds, tools);
    expect(out[0]!.tools).toEqual([{ call: tools[0], matched: false }]);
  });
  it("with no rounds every call is unmatched", () => {
    const tools: ToolCallRow[] = [{ node: "plan", tool: "calc", args: {}, result: 1, duration_ms: 1, created_at: "2026-10-24T05:48:25.000Z" }];
    expect(attachToolCalls([], tools).unmatched).toEqual(tools);
  });
  it("stableStringify ignores key order", () => {
    expect(stableStringify({ b: [1, { d: 1, c: 2 }], a: null })).toBe(stableStringify({ a: null, b: [1, { c: 2, d: 1 }] }));
  });
});

describe("dedupeSystemBlocks", () => {
  it("renders a block once and references it afterwards", () => {
    const calls = [round({ request: { model: "m", max_tokens: 1, effort: "low", format: false, tools: null, system: ["A", "B"], messages: [] } }), round({ request: { model: "m", max_tokens: 1, effort: "low", format: false, tools: null, system: ["A", "C"], messages: [] } }), round({ request: null })];
    const blocks = dedupeSystemBlocks(calls);
    expect(blocks[0]).toEqual([{ text: "A", bytes: 1 }, { text: "B", bytes: 1 }]);
    expect(blocks[1]).toEqual([{ text: "A", bytes: 1, repeatOf: { round: 0, block: 0 } }, { text: "C", bytes: 1 }]);
    expect(blocks[2]).toEqual([]);
  });
});

describe("transcript states", () => {
  const now = new Date("2026-10-24T12:00:00.000Z").getTime();
  it("tells failed, expired, not recorded, empty and present apart", () => {
    expect(responseState(round({ error: "boom", response: null }), now)).toBe("failed");
    expect(responseState(round({ response: null, created_at: "2026-10-01T00:00:00.000Z" }), now)).toBe("expired");
    expect(responseState(round({ response: null, created_at: "2026-10-24T05:00:00.000Z" }), now)).toBe("not_recorded");
    expect(responseState(round({ response: [] }), now)).toBe("empty");
    expect(responseState(round({}), now)).toBe("present");
    expect(requestState(round({ request: null, created_at: "2026-10-01T00:00:00.000Z" }), now)).toBe("expired");
    expect(requestState(round({}), now)).toBe("present");
  });
});

describe("formatUsd", () => {
  it("four decimals, empty for null", () => {
    expect(formatUsd(0.083524)).toBe("$0.0835");
    expect(formatUsd(null)).toBe("");
  });
});
