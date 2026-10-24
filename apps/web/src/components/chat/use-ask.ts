import { useCallback, useRef, useState } from "react";
import { RUN_TIME_BUDGET_MS, type PersonaKey } from "@ask-moov/shared";
import { ask, getRun, listThreadRuns, type AskResponse, type Pin, type RunView } from "@/lib/client/api";

export type UserMsg = { id: string; role: "user"; text: string };
export type AssistantMsg = { id: string; role: "assistant"; runId: string; view: RunView | null; error?: string };
export type NoteMsg = { id: string; role: "note"; text: string };
export type Message = UserMsg | AssistantMsg | NoteMsg;

const POLL_MS = 1000;
/** Polling stops when the run row says succeeded or failed. This cap is only a safety net for a run nobody will ever finish: three attempts' worth of budget plus a minute. */
const POLL_CAP_MS = 3 * RUN_TIME_BUDGET_MS + 60_000;
const isSettled = (v: RunView | null | undefined) => v?.status === "succeeded" || v?.status === "failed";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a chip click shows as the user's turn, live and when reopened: the chip's own label. */
export const pinLabel = (p: Pin): string => (p.detail ? `${p.label}, ${p.detail}` : p.label);

function askErrorText(res: AskResponse): string {
  const body = (res.json ?? {}) as { error?: string; used?: number; budget?: number };
  if (res.status === 429) return `The monthly token budget is used up (${body.used} of ${body.budget}). Ask again next month or raise the budget.`;
  if (res.status === 400) return `The question was rejected: ${body.error ?? "bad request"}.`;
  return `The request failed (${res.status}). ${body.error ?? ""}`.trim();
}

/**
 * Submit a question and poll /api/runs/[id] once a second until it settles (design doc 9.3); reopen a thread with
 * its past answers and keep polling an unfinished run. Message state lives here; layout does not. Every entry point
 * bumps a generation so a poll loop from a previous thread or persona stops touching state.
 */
export function useAsk(persona: PersonaKey, threadId: string, onSettled: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const patch = useCallback((runId: string, p: Partial<AssistantMsg>) => {
    setMessages((m) => m.map((x) => (x.role === "assistant" && x.runId === runId ? { ...x, ...p } : x)));
  }, []);

  /** Poll one run until the row says it is done, or until the safety cap, while this generation is still current. */
  const pollRun = useCallback(async (runId: string, current: () => boolean): Promise<boolean> => {
    const until = Date.now() + POLL_CAP_MS;
    while (current() && Date.now() < until) {
      await sleep(POLL_MS);
      if (!current()) return false;
      const view = await getRun(runId);
      if (view) patch(runId, { view });
      if (isSettled(view)) return true;
    }
    if (current()) patch(runId, { error: "Stopped waiting for this answer. If it finishes later, reopen the thread or see Operations." });
    return false;
  }, [patch]);

  /** opts.pin: a clarification chip the user clicked, sent by id; opts.display: what the transcript shows as the user's turn (the chip's label). */
  const submit = useCallback(async (question: string, opts: { pin?: Pin; display?: string } = {}) => {
    const q = question.trim();
    if (!q || busy) return;
    const gen = generation.current;
    const current = () => generation.current === gen;
    setBusy(true);
    const runId = crypto.randomUUID();
    setMessages((m) => [...m, { id: `u-${runId}`, role: "user", text: opts.display ?? q }, { id: `a-${runId}`, role: "assistant", runId, view: null }]);

    try {
      const res = await ask({ run_id: runId, thread_id: threadId, persona, question: q, ...(opts.pin ? { pin: opts.pin } : {}) });
      if (res.status !== 202) {
        patch(runId, { error: askErrorText(res) });
        return;
      }
      await pollRun(runId, current);
    } catch (e) {
      patch(runId, { error: `Could not reach the server. ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (current()) {
        setBusy(false);
        onSettled();
      }
    }
  }, [busy, persona, threadId, patch, onSettled, pollRun]);

  const reset = useCallback((note?: string) => {
    generation.current += 1;
    setBusy(false);
    setMessages(note ? [{ id: `n-${Date.now()}`, role: "note", text: note }] : []);
  }, []);

  /** Reopen a thread: its questions and answers from the database, then keep polling the last run if it has not finished. */
  const open = useCallback(async (id: string, note: string) => {
    generation.current += 1;
    const gen = generation.current;
    const current = () => generation.current === gen;
    setBusy(false);
    setMessages([{ id: `n-${Date.now()}`, role: "note", text: note }]);
    const runs = await listThreadRuns(id, persona);
    const views = await Promise.all(runs.map((r) => getRun(r.id)));
    if (!current()) return;
    setMessages((m) => [
      ...m,
      ...runs.flatMap((r, i): Message[] => [
        { id: `u-${r.id}`, role: "user", text: r.pins.length > 0 ? r.pins.map(pinLabel).join(", ") : r.question },
        { id: `a-${r.id}`, role: "assistant", runId: r.id, view: views[i] ?? null, ...(views[i] ? {} : { error: "Could not load this answer." }) },
      ]),
    ]);
    const last = runs[runs.length - 1];
    const lastView = views[views.length - 1];
    if (last && lastView && !isSettled(lastView)) {
      setBusy(true);
      try { await pollRun(last.id, current); } finally { if (current()) { setBusy(false); onSettled(); } }
    }
  }, [persona, pollRun, onSettled]);

  return { messages, busy, submit, reset, open };
}
