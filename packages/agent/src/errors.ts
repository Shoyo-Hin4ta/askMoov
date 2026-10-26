import type { MessageParam } from "./llm";

/**
 * Every failure in the agent is one of these. The worker maps them to a run status:
 * RetryableError -> back to queued (attempt + 1); everything else -> failed, with the class name in runs.error.
 */
export class AgentError extends Error {
  readonly retryable: boolean = false;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Transient: rate limit, overload, connection, timeout. The SDK already retried; the run may be requeued. */
export class RetryableError extends AgentError {
  override readonly retryable = true;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

/** Our own deadline on one model call fired. The SDK timer covers only the response headers; this one covers the body. Transient, like other timeouts. */
export class LlmTimeoutError extends RetryableError {
  constructor(readonly timeoutMs: number, readonly elapsedMs: number) {
    super(`model call cut after ${elapsedMs}ms (deadline ${timeoutMs}ms)`);
  }
}

export class LlmRefusedError extends AgentError {
  constructor(readonly category: string | null, explanation: string | null) {
    super(`model declined (${category ?? "unspecified"})${explanation ? `: ${explanation}` : ""}`);
  }
}

export class LlmTruncatedError extends AgentError {
  constructor(readonly maxTokens: number) {
    super(`model output exceeded max_tokens (${maxTokens})`);
  }
}

/**
 * The final reply did not parse. `transcript` is what the failing round was sent (tool rounds included) and `reply` its text,
 * so a corrective call can continue that conversation instead of restarting it and redoing every lookup (2026-10-25, run 9a207dea).
 */
export class LlmParseError extends AgentError {
  constructor(message: string, readonly transcript: readonly MessageParam[] = [], readonly reply = "") {
    super(message);
  }
}

export class BudgetExceededError extends AgentError {
  constructor(readonly used: number, readonly cap: number) {
    super(`run token cap exceeded: ${used} > ${cap}`);
  }
}

/** A plan that is schema-valid but violates a code rule: unknown ref, bad metric/group_by pairing, too many steps. */
export class PlanValidationError extends AgentError {}

/** A `$ref` that does not resolve. Subclass so plan validation and execution can distinguish it when needed. */
export class RefError extends PlanValidationError {}

/** Tier 3 SQL rejected by the validator or by EXPLAIN. */
export class SqlRejectedError extends AgentError {
  constructor(message: string, readonly sql: string) {
    super(message);
  }
}

export class CalcError extends AgentError {}

export class RunBudgetError extends AgentError {
  constructor(readonly elapsedMs: number, readonly budgetMs: number) {
    super(`run exceeded time budget: ${elapsedMs}ms > ${budgetMs}ms`);
  }
}

/** The presenter's chart cannot be drawn from the step it chose (fields outside that step's columns), after its one corrective call. */
export class VizValidationError extends AgentError {}

/** The presenter's text carries a number that appears in none of its inputs (step values, facts, sample rows, entities, question), after its corrective calls. */
export class ProseValidationError extends AgentError {}

/** A 4xx from the API other than rate limiting: bad request, auth, not found. Not retryable; a code or config problem. */
export class LlmRequestError extends AgentError {
  constructor(readonly status: number | undefined, message: string) {
    super(`API request failed${status ? ` (${status})` : ""}: ${message}`);
  }
}
