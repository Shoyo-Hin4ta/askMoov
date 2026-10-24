import type { Results, RunOutput, RunStatus, Trail } from "@/lib/client/api";
import { formatValue } from "@/lib/format";

/**
 * The run trace as getRunTrace returns it to a server component (timestamps are Date objects there; the JSON route sends
 * strings), and the pure functions the run-detail page needs. No React.
 */
export type TracePersona = { role?: string; user_id?: number; school_id?: number; scope_summary?: string };
export type TraceRun = {
  id: string; thread_id: string; persona: TracePersona | null; question: string; status: RunStatus; current_node: string | null; attempt: number;
  path: string | null; latency_ms: number | null; total_tokens: number | null; cost_usd: number | null; git_sha: string | null; uncertain: boolean | null;
  error: string | null; created_at: Date | string; finished_at: Date | string | null;
};
export type TraceStep = { node: string; attempt: number; started_at: Date | string; duration_ms: number; input_summary: unknown; output_summary: unknown; error: string | null };
export type ContentBlock = { type: string; text?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean; thinking?: string };
export type TraceMessage = { role: string; content: string | ContentBlock[] };
export type LlmRequestView = { model: string; max_tokens: number; effort: string; format: boolean; tools: string[] | null; system: string[]; messages: TraceMessage[] };
export type LlmRound = {
  id: number; node: string; model: string; prompt_tokens: number; completion_tokens: number; cache_read_tokens: number; latency_ms: number;
  error: string | null; stop_reason: string | null; request: LlmRequestView | null; response: ContentBlock[] | null; created_at: Date | string;
};
export type ToolCallRow = { node: string; tool: string; args: unknown; result: unknown; duration_ms: number; created_at: Date | string };
export type RunTrace = { run: TraceRun; trail: TraceStep[]; llm_calls: LlmRound[]; tool_calls: ToolCallRow[]; results: Results; output: RunOutput | null };

export type AttachedTool = { call: ToolCallRow; matched: boolean };
export type RoundWithTools = { round: LlmRound; index: number; tools: AttachedTool[] };

const TRANSCRIPT_TTL_MS = 7 * 86_400_000;
const time = (d: Date | string): number => new Date(d).getTime();

/** JSON with keys sorted at every level, so two objects compare equal regardless of key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/**
 * Each tool call under the round whose response asked for it (same tool name, equal input). Timestamps cannot be trusted
 * for this: the tool row is written before the round's row. A call no round asked for stays in time order after the
 * nearest earlier round (the first round when there is none), marked unmatched.
 */
export function attachToolCalls(calls: LlmRound[], tools: ToolCallRow[]): { rounds: RoundWithTools[]; unmatched: ToolCallRow[] } {
  const rounds: RoundWithTools[] = calls.map((round, index) => ({ round, index, tools: [] }));
  const open = rounds.map((r) => (r.round.response ?? []).filter((b) => b.type === "tool_use").map((b) => ({ name: String(b.name), input: stableStringify(b.input), used: false })));
  const unmatched: ToolCallRow[] = [];
  for (const call of [...tools].sort((a, b) => time(a.created_at) - time(b.created_at))) {
    const key = stableStringify(call.args);
    let placed = false;
    for (let i = 0; i < rounds.length && !placed; i++) {
      const slot = open[i]!.find((u) => !u.used && u.name === call.tool && u.input === key);
      if (slot) { slot.used = true; rounds[i]!.tools.push({ call, matched: true }); placed = true; }
    }
    if (placed) continue;
    if (rounds.length === 0) { unmatched.push(call); continue; }
    const earlier = rounds.filter((r) => time(r.round.created_at) <= time(call.created_at));
    (earlier[earlier.length - 1] ?? rounds[0]!).tools.push({ call, matched: false });
  }
  return { rounds, unmatched };
}

export type SystemBlockView = { text: string; bytes: number; repeatOf?: { round: number; block: number } };

/** System blocks per round; a block identical to an earlier one is a reference, so the page carries each large block once. */
export function dedupeSystemBlocks(calls: LlmRound[]): SystemBlockView[][] {
  const seen = new Map<string, { round: number; block: number }>();
  return calls.map((call, round) => (call.request?.system ?? []).map((text, block) => {
    const first = seen.get(text);
    const bytes = new TextEncoder().encode(text).length;
    if (first) return { text, bytes, repeatOf: first };
    seen.set(text, { round, block });
    return { text, bytes };
  }));
}

export type TranscriptState = "present" | "failed" | "expired" | "not_recorded" | "empty";

function ageState(call: LlmRound, now: number): TranscriptState {
  return now - time(call.created_at) > TRANSCRIPT_TTL_MS ? "expired" : "not_recorded";
}

/** Why a request is missing: the retention job cleared it, or the row predates stored transcripts. */
export function requestState(call: LlmRound, now = Date.now()): TranscriptState {
  return call.request ? "present" : ageState(call, now);
}

/** Why a response is missing: the call failed (its error is stored), retention, a pre-transcript row, or the model returned nothing. */
export function responseState(call: LlmRound, now = Date.now()): TranscriptState {
  if (call.error) return "failed";
  if (call.response === null || call.response === undefined) return ageState(call, now);
  if (call.response.length === 0) return "empty";
  return "present";
}

export const STATE_TEXT: Record<Exclude<TranscriptState, "present">, string> = {
  failed: "The call failed",
  expired: "Expired after 7 days",
  not_recorded: "Not recorded (this round predates stored transcripts)",
  empty: "Empty response",
};

export function formatUsd(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : `$${n.toFixed(4)}`;
}

/** "2026-10-24 05:48:13.117": rounds are seconds apart, so the time needs milliseconds. */
export function formatTimestamp(d: Date | string): string {
  return new Date(d).toISOString().replace("T", " ").replace("Z", "");
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export function tokenSummary(call: Pick<LlmRound, "prompt_tokens" | "completion_tokens" | "cache_read_tokens">): string {
  const total = formatValue(call.prompt_tokens + call.completion_tokens);
  return call.cache_read_tokens > 0 ? `${total} tok (${formatValue(call.cache_read_tokens)} cached)` : `${total} tok`;
}

/** Pretty JSON for display; a string is shown as is, a JSON string is parsed first. */
export function pretty(v: unknown): string {
  if (typeof v === "string") {
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
  }
  return JSON.stringify(v, null, 2) ?? String(v);
}

/** What the chat's RunTrail needs from a trace. */
export function trailView(run: TraceRun, trail: TraceStep[]): { status: RunStatus; attempt: number; trail: Trail } {
  return { status: run.status, attempt: run.attempt, trail: trail.map((t) => ({ node: t.node, attempt: t.attempt, started_at: String(t.started_at), duration_ms: t.duration_ms, error: t.error })) };
}
