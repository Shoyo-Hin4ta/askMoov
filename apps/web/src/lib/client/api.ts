/** Browser-side API client and the shape of what /api/runs/[id] returns. No Supabase key, no secrets, only our own routes. */
import type { PersonaKey } from "@ask-moov/shared";

export type Trail = { node: string; attempt: number; started_at: string; duration_ms: number; error: string | null }[];
export type StepOut = { id: string; kind: "spec" | "calc" | "sql"; status?: string; sql?: string; params?: unknown[]; shape?: string; row_count?: number; value?: unknown; explanation?: string; error?: string };
export type Results = Record<string, { columns: string[]; row_count: number; rows: Record<string, unknown>[] }>;
export type VizOut = { type: "stat" | "line" | "bar" | "calendar" | "table"; title: string; x?: { field: string; label: string }; y?: { field: string; label: string }; series?: string[]; caveats: string[]; step?: string } | null;
export type ClarificationOption = { label: string; entity?: { type: string; id: number | string; label?: string; detail?: string } };
/** What a clicked chip sends back: the chosen entity by id. */
export type Pin = { type: string; id: number | string; label: string; detail?: string };
export type PlanOut = { kind: "plan"; answer_from: string[]; expected_shape: string } | { kind: "out_of_scope"; reason: string; message: string; suggestion?: string; options?: ClarificationOption[] } | null;
export type Caveat = { kind: string; text: string };
export type RunOutput = { answer_md: string; viz: VizOut; caveats: Caveat[]; steps: StepOut[]; plan: PlanOut; results: Results };
export type RunStatus = "queued" | "running" | "succeeded" | "failed";
export type RunView = {
  id: string; thread_id: string; status: RunStatus; current_node: string | null; attempt: number; error: string | null; question: string;
  trail: Trail;
  output?: RunOutput;
};
export type Thread = { thread_id: string; first_question: string; last_asked_at: string; runs: number };
export type ThreadRun = { id: string; question: string; status: RunStatus; pins: Pin[] };

export type AskResponse = { status: number; json: unknown };

export async function ask(body: { run_id: string; thread_id: string; persona: PersonaKey; question: string; pin?: Pin }): Promise<AskResponse> {
  const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

export async function getRun(id: string): Promise<RunView | null> {
  const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as RunView) : null;
}

export async function vote(runId: string, v: 1 | -1): Promise<boolean> {
  const res = await fetch(`/api/runs/${runId}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vote: v }) });
  return res.ok;
}

export async function listThreadRuns(threadId: string, persona: PersonaKey): Promise<ThreadRun[]> {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}?persona=${persona}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as { runs: ThreadRun[] }).runs : [];
}

export async function listThreads(persona: PersonaKey): Promise<Thread[]> {
  const res = await fetch(`/api/threads?persona=${persona}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as { threads: Thread[] }).threads : [];
}
