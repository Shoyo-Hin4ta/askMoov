import type { RunView } from "@/lib/client/api";

/** What the trail needs from a run: the chat passes a RunView, the run-detail page builds this from a trace. */
export type TrailView = Pick<RunView, "status" | "attempt" | "trail">;

/** The fixed graph, in order. Labels are what a reader does, not node names. */
const NODE_ORDER = ["sketch", "plan", "execute", "critique", "present"] as const;
type Node = (typeof NODE_ORDER)[number];
const NODE_LABEL: Record<Node, string> = { sketch: "Read", plan: "Plan", execute: "Run", critique: "Check", present: "Write" };
const RUNNING_TEXT: Record<Node, string> = {
  sketch: "Reading the question",
  plan: "Planning the query",
  execute: "Running it against the database",
  critique: "Checking the result",
  present: "Writing the answer",
};

export type TrailEntry = { key: string; label: string; state: "done" | "active" | "pending" | "failed"; duration_ms?: number };

/** Nodes outside the fixed order that the runtime can record. */
const EXTRA_LABEL: Record<string, string> = { fail: "Failed" };

function label(node: string, n: number): string {
  const base = (NODE_LABEL as Record<string, string>)[node] ?? EXTRA_LABEL[node] ?? node;
  return n > 1 ? `${base} ${n}` : base;
}

/**
 * The node running now. `current_node` is written after a node finishes (runtime.ts: insertStep, then setCurrentNode; liveness is a separate timer),
 * so it names the last completed node; the running one is the next in the fixed order. A replan or a further
 * execute step shows as the predicted next node until it finishes and appears in the trail as "Plan 2" or "Run 2".
 */
export function runningNode(view: TrailView | null): Node | null {
  if (view?.status !== "running") return null;
  const last = view.trail[view.trail.length - 1]?.node as Node | undefined;
  if (!last) return NODE_ORDER[0];
  const idx = NODE_ORDER.indexOf(last);
  return NODE_ORDER[Math.min(idx + 1, NODE_ORDER.length - 1)]!;
}

/** Finished nodes from the trail, then the running node and what is still expected after it. Repeats are numbered. */
export function trailEntries(view: TrailView | null): TrailEntry[] {
  const counts: Record<string, number> = {};
  const done: TrailEntry[] = (view?.trail ?? []).map((t) => {
    counts[t.node] = (counts[t.node] ?? 0) + 1;
    return { key: `${t.node}-${counts[t.node]}`, label: label(t.node, counts[t.node]!), state: t.error ? "failed" : "done", duration_ms: t.duration_ms };
  });
  const finished = view?.status === "succeeded" || view?.status === "failed";
  if (finished) return done;

  const active = runningNode(view);
  const startIdx = active ? NODE_ORDER.indexOf(active) : 0;
  const rest: TrailEntry[] = NODE_ORDER.slice(startIdx).map((node, i) => {
    const n = (counts[node] ?? 0) + 1;
    return { key: `${node}-${n}`, label: label(node, n), state: i === 0 && active ? "active" : "pending" };
  });
  return [...done, ...rest];
}

export function totalMs(view: TrailView | null): number {
  return (view?.trail ?? []).reduce((sum, t) => sum + (t.duration_ms ?? 0), 0);
}

/** One line of status text while a run is in flight (design doc 13.3). */
export function statusLine(view: TrailView | null): string {
  if (!view) return "Sending the question";
  if (view.status === "queued") return "Waiting for a worker";
  const node = runningNode(view);
  return node ? RUNNING_TEXT[node] : "Working on it";
}
