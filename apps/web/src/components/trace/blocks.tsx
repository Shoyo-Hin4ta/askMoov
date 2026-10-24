import { CodeBlock } from "@/components/ui/code-block";
import { pretty, type ContentBlock } from "@/lib/trace";

/** A message's content: a string, or content blocks rendered by type. Unknown block types are shown as JSON, never dropped. */
export function Blocks({ content, label }: { content: string | ContentBlock[]; label: string }) {
  if (typeof content === "string") return <CodeBlock label={label}>{content}</CodeBlock>;
  return (
    <div className="space-y-2">
      {content.map((b, i) => <Block key={i} block={b} label={`${label}, block ${i + 1}`} />)}
    </div>
  );
}

function Block({ block, label }: { block: ContentBlock; label: string }) {
  const kind = (text: string, extra?: React.ReactNode) => (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
      <span>{text}</span>
      {extra}
    </div>
  );
  switch (block.type) {
    case "text":
      return <CodeBlock label={label}>{String(block.text ?? "")}</CodeBlock>;
    case "tool_use":
      return (
        <div>
          {kind("tool_use", <span className="font-mono text-ink">{String(block.name ?? "")}</span>)}
          <CodeBlock label={label}>{pretty(block.input)}</CodeBlock>
        </div>
      );
    case "tool_result":
      return (
        <div>
          {kind("tool_result", block.is_error ? <span className="text-danger">error</span> : null)}
          <CodeBlock label={label}>{pretty(block.content)}</CodeBlock>
        </div>
      );
    case "thinking":
      return (
        <div>
          {kind("thinking")}
          <CodeBlock label={label}>{String(block.thinking ?? "")}</CodeBlock>
        </div>
      );
    default:
      return (
        <div>
          {kind(block.type)}
          <CodeBlock label={label}>{pretty(block)}</CodeBlock>
        </div>
      );
  }
}
