import { attachToolCalls, dedupeSystemBlocks, type LlmRound, type ToolCallRow } from "@/lib/trace";
import { RoundCard, ToolCallCard } from "./round-card";

/** Every model round in time order with the tool calls it asked for; calls no round asked for come last. `openRound` is a call id whose card starts open. */
export function Rounds({ calls, tools, openRound }: { calls: LlmRound[]; tools: ToolCallRow[]; openRound?: string }) {
  const { rounds, unmatched } = attachToolCalls(calls, tools);
  const systemBlocks = dedupeSystemBlocks(calls);
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-ink">Rounds <span className="text-sm font-normal text-ink-3">{rounds.length} model call{rounds.length === 1 ? "" : "s"}, {tools.length} tool call{tools.length === 1 ? "" : "s"}</span></h2>
      {rounds.length === 0 && <p className="text-xs text-ink-3">No model calls recorded for this run.</p>}
      {rounds.map((r) => <RoundCard key={r.round.id} round={r.round} index={r.index} tools={r.tools} systemBlocks={systemBlocks[r.index] ?? []} open={openRound !== undefined && String(r.round.id) === openRound} />)}
      {unmatched.map((call, i) => <ToolCallCard key={`u${i}`} tool={{ call, matched: false }} />)}
    </section>
  );
}
