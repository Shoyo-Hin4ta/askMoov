import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { PER_CALL_TIMEOUT_MS } from "@ask-moov/shared";
import {
  AgentError, BudgetExceededError, LlmParseError, LlmRefusedError, LlmRequestError, LlmTimeoutError, LlmTruncatedError, RetryableError, RunBudgetError,
} from "./errors";

/**
 * The only file that imports the Anthropic SDK. Every model call in the graph goes through Llm.callStructured.
 * Design doc 4.12: refusal, truncation, unparseable output and the per-run token cap fail fast with a named error;
 * rate limits, overload, 5xx and connection problems (after the SDK's own retries) become RetryableError.
 * Optional bounded tool loop for the planner: tool_use rounds run through `onToolUse`, then the final JSON is parsed.
 */
export const MODELS = {
  main: "claude-opus-5-5",
  sketch: "claude-haiku-5-5",
} as const;

export type LlmClient = {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<Anthropic.Message> };
};

export type LlmUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/** One row of ops.llm_calls. The shape is declared in @ask-moov/db so the data layer does not depend on the agent. */
export type { LlmCallRecord } from "@ask-moov/db";
import type { LlmCallRecord } from "@ask-moov/db";

export type MessageParam = Anthropic.MessageParam;
export type TextBlockParam = Anthropic.TextBlockParam;
export type ToolDefinition = Anthropic.Tool;

export type ToolHandler = (name: string, input: unknown) => Promise<unknown>;

export type StructuredCall<T> = {
  node: string;
  model: string;
  schema: z.ZodType<T>;
  /**
   * null = do not send output_config.format. The planner's nested plan/step unions exceed the API's compiled-grammar
   * limit, so it answers in plain JSON that is parsed strictly here and corrected once by the plan node on mismatch.
   */
  formatSchema?: z.ZodType | null;
  system: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  max_tokens?: number;
  effort?: "low" | "medium" | "high";
  tools?: Anthropic.Tool[];
  onToolUse?: ToolHandler;
  maxToolRounds?: number;
  /** The run's start and total time budget. Checked before every round; the per-call deadline never exceeds what is left. */
  budget?: { started_at: number; total_ms: number };
};

export type LlmOptions = {
  runTokenCap: number;
  /** Tokens the run has already spent on earlier attempts (design 4.13: the cap is per run, not per attempt). Default 0. */
  usedTokens?: number;
  /** Deadline for one model call, body included. Defaults to PER_CALL_TIMEOUT_MS; tests shorten it. */
  perCallTimeoutMs?: number;
  /** Called once per API round, success or failure. The worker uses it to write ops.llm_calls. */
  onCall?: (record: LlmCallRecord) => Promise<void> | void;
};

const DEFAULT_MAX_TOKENS = 8_000;
const DEFAULT_TOOL_ROUNDS = 6;

/** The JSON schema the API will receive for a Zod schema. Dev utility for inspecting $defs and unsupported keywords. */
export function outputSchemaJson(schema: z.ZodType): Record<string, unknown> {
  return zodOutputFormat(schema).schema as Record<string, unknown>;
}

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ timeout: 30_000, maxRetries: 2 });
}

export class Llm {
  #used: number;

  constructor(private readonly client: LlmClient, private readonly options: LlmOptions) {
    this.#used = options.usedTokens ?? 0;
  }

  /** Tokens consumed by this run so far, all kinds counted. */
  get tokensUsed(): number {
    return this.#used;
  }

  async callStructured<T>(call: StructuredCall<T>): Promise<{ output: T; usage: LlmUsage; latency_ms: number; messages: Anthropic.MessageParam[] }> {
    const format = call.formatSchema === null ? null : zodOutputFormat(call.formatSchema ?? call.schema);
    const maxTokens = call.max_tokens ?? DEFAULT_MAX_TOKENS;
    const maxRounds = call.tools ? (call.maxToolRounds ?? DEFAULT_TOOL_ROUNDS) : 1;
    const messages: Anthropic.MessageParam[] = [...call.messages];
    const total: LlmUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let latency_ms = 0;

    for (let round = 1; round <= maxRounds; round++) {
      // Run budget first: a replan at second 230 must not start a fresh 25-second planner call.
      let remaining = Number.POSITIVE_INFINITY;
      if (call.budget) {
        const elapsed = Date.now() - call.budget.started_at;
        if (elapsed >= call.budget.total_ms) throw new RunBudgetError(elapsed, call.budget.total_ms);
        remaining = call.budget.total_ms - elapsed;
      }
      // The SDK's timeout covers only the wait for response headers; the body, where generation time goes, is read with no timer.
      // A caller signal stays attached until the body is settled, so this deadline cuts a stalled read (SDK 1.1.0, internal/request-signal).
      const timeoutMs = Math.min(this.options.perCallTimeoutMs ?? PER_CALL_TIMEOUT_MS, remaining);
      const signal = AbortSignal.timeout(timeoutMs);
      const started = Date.now();
      let message: Anthropic.Message;
      try {
        message = await this.client.messages.create({
          model: call.model,
          max_tokens: maxTokens,
          system: call.system,
          messages,
          output_config: { ...(format ? { format } : {}), effort: call.effort ?? "medium" },
          ...(call.tools ? { tools: call.tools } : {}),
        }, { signal });
      } catch (e) {
        const err = signal.aborted ? new LlmTimeoutError(timeoutMs, Date.now() - started) : mapSdkError(e);
        await this.record({ node: call.node, model: call.model, prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, latency_ms: Date.now() - started, response_excerpt: "", error: err.message });
        throw err;
      }
      const roundMs = Date.now() - started;
      latency_ms += roundMs;

      const usage = usageOf(message);
      for (const k of Object.keys(total) as (keyof LlmUsage)[]) total[k] += usage[k];
      this.#used += usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;

      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

      let failure: AgentError | null = null;
      let output: T | undefined;
      if (message.stop_reason === "refusal") {
        failure = new LlmRefusedError(message.stop_details?.category ?? null, message.stop_details?.explanation ?? null);
      } else if (message.stop_reason === "max_tokens") {
        failure = new LlmTruncatedError(maxTokens);
      } else if (this.#used > this.options.runTokenCap) {
        failure = new BudgetExceededError(this.#used, this.options.runTokenCap);
      } else if (message.stop_reason === "tool_use" && toolUses.length > 0) {
        if (!call.onToolUse) failure = new LlmRequestError(undefined, "model requested a tool but no handler was provided");
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(extractJson(text));
        } catch (e) {
          failure = new LlmParseError(`not JSON: ${(e as Error).message}`);
        }
        if (!failure) {
          const result = call.schema.safeParse(parsed);
          if (result.success) output = result.data;
          else failure = new LlmParseError(result.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
        }
      }

      await this.record({
        node: call.node,
        model: call.model,
        prompt_tokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        completion_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_input_tokens,
        latency_ms: roundMs,
        response_excerpt: (text || toolUses.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join("; ")).slice(0, 500),
        error: failure?.message ?? null,
      });
      if (failure) throw failure;

      if (output !== undefined) return { output, usage: total, latency_ms, messages };

      // tool round: run every requested tool, return all results in one user message
      const results = await Promise.all(toolUses.map(async (t) => {
        let content: string;
        let is_error = false;
        try {
          content = JSON.stringify(await call.onToolUse!(t.name, t.input));
        } catch (e) {
          content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          is_error = true;
        }
        return { type: "tool_result" as const, tool_use_id: t.id, content, is_error };
      }));
      messages.push({ role: "assistant", content: message.content }, { role: "user", content: results });
    }
    throw new LlmRequestError(undefined, `model did not produce a final answer within ${maxRounds} tool rounds`);
  }

  private async record(r: LlmCallRecord): Promise<void> {
    await this.options.onCall?.(r);
  }
}

/** Without a grammar the model may wrap JSON in a code fence or a sentence; take the outermost object. */
function extractJson(text: string): string {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function usageOf(m: Anthropic.Message): LlmUsage {
  return {
    input_tokens: m.usage.input_tokens,
    output_tokens: m.usage.output_tokens,
    cache_read_input_tokens: m.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: m.usage.cache_creation_input_tokens ?? 0,
  };
}

/** SDK error -> agent error. Retryable only for the classes the SDK itself retries. */
export function mapSdkError(e: unknown): AgentError {
  if (e instanceof AgentError) return e;
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
    return new RetryableError(`${e.constructor.name}: ${e.message}`, e);
  }
  if (e instanceof Anthropic.APIError) return new LlmRequestError(e.status, e.message);
  if (e instanceof Anthropic.AnthropicError) return new LlmParseError(e.message);
  return new LlmRequestError(undefined, e instanceof Error ? e.message : String(e));
}
