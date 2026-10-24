import * as ops from "@ask-moov/db";
import { getAppPool, getQueryPool, requireEnv, withScope } from "@ask-moov/db";
import { HEARTBEAT_INTERVAL_MS, RUN_TIME_BUDGET_MS } from "@ask-moov/shared";
import { createCheckpointer } from "./checkpointer";
import type { AgentDeps } from "./deps";
import { retrieveEpisodes, templatize, writeEpisode } from "./episodes";
import { RetryableError } from "./errors";
import { buildGraph } from "./graph";
import { startHeartbeat } from "./heartbeat";
import { createAnthropicClient, Llm, type LlmClient } from "./llm";
import { currentSchemaVersion, loadSchemaDoc, type SchemaDoc } from "./schema-doc";
import { newRunInput, type State } from "./state";
import { answerShape } from "./nodes/shared";

/**
 * Runs one claimed run to completion (design doc 2.1 steps 5-9). Shared by the worker route and the eval runner.
 * Process-level caches survive warm invocations: Anthropic client, checkpointer, schema document.
 */
export type RuntimeOptions = {
  runTokenCap: number;
  episodesEnabled: boolean;
  chaosEnabled: boolean;
  gitSha: string;
  /** Called when a retryable failure requeued the run, so the caller can ping the worker. */
  onRequeue?: (runId: string) => Promise<void>;
  /** Lease renewal interval. Defaults to HEARTBEAT_INTERVAL_MS; tests shorten it. */
  heartbeatMs?: number;
  /** The model client. Defaults to the process-wide Anthropic client; the durability tests pass a scripted fake. */
  client?: LlmClient;
};

const MAX_ATTEMPTS = 3;
type AppQuery = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;
const appQuery: AppQuery = async (sql, params) => (await getAppPool().query(sql, params)).rows;

let schemaCache: SchemaDoc | null = null;
let checkpointer: ReturnType<typeof createCheckpointer> | null = null;
let client: ReturnType<typeof createAnthropicClient> | null = null;

/** One cheap query per invocation; the full document reloads only when the database says the schema changed. */
export async function schemaDoc(): Promise<SchemaDoc> {
  const version = await currentSchemaVersion(appQuery);
  if (!schemaCache || schemaCache.version !== version) {
    schemaCache = await loadSchemaDoc(appQuery);
    await getAppPool().query("UPDATE ops.schema_meta SET schema_version = $1, loaded_at = now()", [schemaCache.version]);
  }
  return schemaCache;
}

export async function frozenNow(): Promise<string> {
  const rows = await appQuery("SELECT frozen_now FROM ops.schema_meta", []);
  return new Date(rows[0]!["frozen_now"] as string).toISOString();
}

/** `usedTokens`: what earlier attempts of this run already spent, so the per-run cap spans attempts (design 4.13). */
export function buildDeps(run: ops.RunRow, doc: SchemaDoc, now: string, o: RuntimeOptions, usedTokens = 0): AgentDeps {
  const llm = new Llm(o.client ?? (client ??= createAnthropicClient()), { runTokenCap: o.runTokenCap, usedTokens, onCall: (r) => ops.insertLlmCall(run.id, r, o.gitSha) });
  return {
    llm,
    schemaDoc: doc,
    frozenNow: now,
    scopedQuery: (persona, sql, params) =>
      withScope(getQueryPool(), persona, async (c) => {
        const r = await c.query(sql, params);
        return { rows: r.rows, columns: r.fields.map((f) => f.name) };
      }),
    results: { put: ops.putResult, get: ops.getResult },
    episodes: o.episodesEnabled ? { retrieve: (a) => retrieveEpisodes(appQuery, a), write: (e) => writeEpisode(appQuery, e) } : null,
    trace: {
      toolCall: ops.insertToolCall,
      // progress only; liveness is the heartbeat timer in executeRun
      step: async (r) => {
        await ops.insertStep(r);
        await ops.setCurrentNode(run.id, r.node);
      },
    },
    attempt: run.attempt,
    chaos: o.chaosEnabled && run.persona.chaos ? run.persona.chaos : null,
    pins: (run.pins ?? []).map((p) => ({ type: p.type, id: p.id, label: p.label, detail: p.detail ?? "", text: p.label })),
  };
}

/** The whole lifecycle for one claimed run: graph (fresh or resumed), outputs, episode, final status, retry mapping. */
export async function executeRun(run: ops.RunRow, o: RuntimeOptions): Promise<State | null> {
  const started = Date.now();
  // Liveness runs beside the work: the cron reads heartbeat_at from this timer, the UI reads current_node from the node trace.
  const stopHeartbeat = startHeartbeat({
    beat: () => ops.heartbeat(run.id, run.attempt),
    intervalMs: o.heartbeatMs ?? HEARTBEAT_INTERVAL_MS,
    budgetMs: RUN_TIME_BUDGET_MS,
    startedAt: started,
    onWarn: (message) => console.error(`run ${run.id}: ${message}`),
  });
  try {
    const [doc, now, usedTokens] = await Promise.all([schemaDoc(), frozenNow(), run.attempt > 1 ? ops.runTokensUsed(run.id) : Promise.resolve(0)]);
    checkpointer ??= createCheckpointer(requireEnv("DATABASE_URL_APP"));
    const deps = buildDeps(run, doc, now, o, usedTokens);
    const graph = buildGraph(deps, checkpointer);
    const config = { configurable: { thread_id: run.thread_id } };
    const snapshot = await graph.getState(config);
    const values = snapshot?.values as Partial<State> | undefined;
    const resuming = values?.run_id === run.id && (snapshot?.next?.length ?? 0) > 0;
    const input = resuming
      ? null
      : newRunInput({ run_id: run.id, thread_id: run.thread_id, persona: run.persona, question: run.question, schema_version: doc.version, git_sha: o.gitSha });
    const final = (await graph.invoke(input as never, config)) as State;
    await complete(run, final, doc.version, o, started, deps.episodes);
    return final;
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    try {
      if (e instanceof RetryableError && run.attempt < MAX_ATTEMPTS) {
        await ops.requeueRun(run.id, message);
        await o.onRequeue?.(run.id);
        return null;
      }
      await ops.finishRun(run.id, {
        status: "failed", error: message, latency_ms: Date.now() - started, path: null, uncertain: false, metrics: [],
        answer_excerpt: null, episode_id: null, schema_version: schemaCache?.version ?? "",
      });
      return null;
    } catch (write) {
      // The trace store refused the status write (2026-10-22: the platform had put the database in read-only mode).
      // The thrown error carries the original cause, which is the one that explains the run.
      const detail = write instanceof Error ? write.message : String(write);
      throw new Error(`run ${run.id} failed (${message}) and recording the failure failed too: ${detail}`);
    }
  } finally {
    stopHeartbeat();
  }
}

async function complete(run: ops.RunRow, final: State, schemaVersion: string, o: RuntimeOptions, started: number, episodes: AgentDeps["episodes"]): Promise<void> {
  if (final.error) {
    await ops.finishRun(run.id, {
      status: "failed", error: final.error, latency_ms: Date.now() - started, path: final.path, uncertain: false, metrics: [],
      answer_excerpt: null, episode_id: null, schema_version: schemaVersion,
    });
    return;
  }
  const plan = final.plan_output;
  const steps = plan?.kind === "plan"
    ? plan.steps.map((s) => {
      const r = final.steps[s.id];
      return { id: s.id, kind: s.kind, status: r?.status, sql: r?.sql, params: r?.params, shape: r?.shape, row_count: r?.row_count, value: r?.value, explanation: r?.explanation, error: r?.error };
    })
    : [];
  await ops.insertRunEntities(run.id, final.resolved.entities);
  await ops.saveOutput(run.id, { answer_md: final.answer ?? "", viz: final.viz, caveats: final.caveats, steps, plan });

  let episodeId: number | null = null;
  if (episodes && plan?.kind === "plan") {
    const score = final.critic_verdict?.pass ? 1 : final.uncertain ? -1 : null;
    if (score !== null) {
      episodeId = await episodes.write({
        role: run.persona.role,
        questionTemplated: templatize(run.question, final.resolved.entities, final.resolved.dates.map((d) => d.text)),
        plan, shape: answerShape(plan, final.steps, final.viz), critique: final.critic_verdict, score, schemaVersion, gitSha: o.gitSha,
      });
    }
  }
  const metrics = plan?.kind === "plan" ? [...new Set(plan.steps.flatMap((s) => (s.kind === "spec" ? [s.spec.metric] : [])))] : [];
  await ops.finishRun(run.id, {
    status: "succeeded", error: null, latency_ms: Date.now() - started, path: final.path, uncertain: final.uncertain, metrics,
    answer_excerpt: (final.answer ?? "").slice(0, 200), episode_id: episodeId, schema_version: schemaVersion,
  });
}
