"use client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** GFM tables scroll inside the card instead of widening it. */
const COMPONENTS: Components = {
  table: ({ node, ...props }) => {
    void node; // hast node, not a DOM attribute
    return (
      <div className="overflow-x-auto">
        <table {...props} />
      </div>
    );
  },
};

/** Answer text: raw HTML off, no images, no links. The model's prose can never load a URL from the reader's browser. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="answer-md text-sm text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img", "a", "iframe", "script"]} unwrapDisallowed components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
