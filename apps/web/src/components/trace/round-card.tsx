import { cn } from "@/components/ui/cn";
import { CodeBlock } from "@/components/ui/code-block";
import { Disclosure } from "@/components/ui/disclosure";
import { KvList } from "@/components/ui/kv-list";
import { Tabs } from "@/components/ui/tabs";
import { EMPTY_CELL, formatDuration, formatValue } from "@/lib/format";
import { formatBytes, formatTimestamp, pretty, requestState, responseState, STATE_TEXT, tokenSummary, type AttachedTool, type LlmRound, type SystemBlockView, type TranscriptState } from "@/lib/trace";
import { Blocks } from "./blocks";

function StateNote({ state, error }: { state: Exclude<TranscriptState, "present">; error: string | null }) {
  return <p className="text-sm text-ink-2">{STATE_TEXT[state]}{state === "failed" && error ? <span className="text-danger">: {error}</span> : "."}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-medium text-ink-2">{title}</h4>
      {children}
    </section>
  );
}

/** One model round: what was sent, what came back, and the numbers. Collapsed by default; the tool calls it asked for sit under it. */
export function RoundCard({ round, index, tools, systemBlocks }: { round: LlmRound; index: number; tools: AttachedTool[]; systemBlocks: SystemBlockView[] }) {
  const req = round.request;
  const reqState = requestState(round);
  const resState = responseState(round);
  const title = `${round.node} · ${round.model} · ${formatDuration(round.latency_ms)} · ${tokenSummary(round)}`;

  const request = req ? (
    <div className="space-y-3">
      {systemBlocks.map((b, j) => (
        <Section key={j} title={`System block ${j + 1} (${formatBytes(b.bytes)})`}>
          {b.repeatOf
            ? <p className="text-xs text-ink-3">Same as round {b.repeatOf.round + 1}, block {b.repeatOf.block + 1}.</p>
            : <CodeBlock label={`Round ${index + 1} system block ${j + 1}`}>{b.text}</CodeBlock>}
        </Section>
      ))}
      {req.messages.map((m, j) => (
        <Section key={`m${j}`} title={`Message ${j + 1}: ${m.role}`}>
          <Blocks content={m.content} label={`Round ${index + 1} message ${j + 1}`} />
        </Section>
      ))}
    </div>
  ) : <StateNote state={reqState as Exclude<TranscriptState, "present">} error={null} />;

  const response = resState === "present" && round.response
    ? <Blocks content={round.response} label={`Round ${index + 1} response`} />
    : <StateNote state={resState as Exclude<TranscriptState, "present">} error={round.error} />;

  const meta = (
    <KvList items={[
      ["Stop reason", round.stop_reason ?? EMPTY_CELL],
      ["Prompt tokens", formatValue(round.prompt_tokens)],
      ["Completion tokens", formatValue(round.completion_tokens)],
      ["Cache read tokens", formatValue(round.cache_read_tokens)],
      ["Latency", formatDuration(round.latency_ms)],
      ["Error", round.error ? <span className="text-danger">{round.error}</span> : EMPTY_CELL],
      ["Created", formatTimestamp(round.created_at)],
      ["max_tokens", req ? formatValue(req.max_tokens) : EMPTY_CELL],
      ["Effort", req?.effort ?? EMPTY_CELL],
      ["Structured output", req ? (req.format ? "on" : "off") : EMPTY_CELL],
      ["Tools", req ? (req.tools?.length ? req.tools.join(", ") : "none") : EMPTY_CELL],
    ]} />
  );

  return (
    <Disclosure summary={<span className={cn(round.error && "text-danger")}>{title}{round.error ? " · failed" : ""}</span>}>
      <Tabs label={`Round ${index + 1}`} tabs={[
        { id: "request", label: "Request", content: request },
        { id: "response", label: "Response", content: response },
        { id: "meta", label: "Meta", content: meta },
      ]} />
      {tools.length > 0 && (
        <div className="mt-3 space-y-2">
          {tools.map((t, k) => <ToolCallCard key={k} tool={t} />)}
        </div>
      )}
    </Disclosure>
  );
}

/** A tool the round asked for and what it returned. */
export function ToolCallCard({ tool }: { tool: AttachedTool }) {
  const { call, matched } = tool;
  return (
    <div className="rounded-control border border-line p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-2">
        <span>tool</span>
        <span className="font-mono text-ink">{call.tool}</span>
        <span>{formatDuration(call.duration_ms)}</span>
        <span>{formatTimestamp(call.created_at)}</span>
        {!matched && <span className="text-ink-3">(no matching tool_use in this round)</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Section title="Arguments"><CodeBlock label={`${call.tool} arguments`}>{pretty(call.args)}</CodeBlock></Section>
        <Section title="Result"><CodeBlock label={`${call.tool} result`}>{pretty(call.result)}</CodeBlock></Section>
      </div>
    </div>
  );
}
