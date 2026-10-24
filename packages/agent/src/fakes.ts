import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "./llm";

/** Test-only. A scripted model client for the graph and the runtime: no network, no key. Shared by the unit and database tests. */
export type Reply = { json?: unknown; toolUse?: { name: string; input: unknown }[]; error?: Error };
export type NodeKey = "sketch" | "plan" | "critique" | "present";

export function msg(reply: Reply): Anthropic.Message {
  const content: Anthropic.ContentBlock[] = [];
  if (reply.toolUse) for (const [i, t] of reply.toolUse.entries()) content.push({ type: "tool_use", id: `tu_${i}`, name: t.name, input: t.input } as Anthropic.ToolUseBlock);
  else content.push({ type: "text", text: JSON.stringify(reply.json), citations: null } as Anthropic.TextBlock);
  return {
    id: "m", type: "message", role: "assistant", model: "fake", content,
    stop_reason: reply.toolUse ? "tool_use" : "end_turn", stop_sequence: null, stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/** Routes each API call to a per-node script by sniffing the system prompt. Each script entry is consumed in order; the last one repeats. */
export function fakeClient(script: Partial<Record<NodeKey, Reply[]>>): { client: LlmClient; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const client: LlmClient = {
    messages: {
      async create(params) {
        const sys = typeof params.system === "string" ? params.system : (params.system ?? []).map((b) => b.text).join("\n");
        const node: NodeKey = sys.startsWith("Classify") ? "sketch" : sys.startsWith("You are the planner") ? "plan" : sys.startsWith("You are the critic") ? "critique" : "present";
        calls[node] = (calls[node] ?? 0) + 1;
        const queue = script[node] ?? [];
        const reply = queue.length > 1 ? queue.shift()! : queue[0];
        if (!reply) throw new Error(`no scripted reply for ${node}`);
        if (reply.error) throw reply.error;
        return msg(reply);
      },
    },
  };
  return { client, calls };
}
