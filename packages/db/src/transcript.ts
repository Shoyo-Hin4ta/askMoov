import { createHash } from "node:crypto";

/**
 * How a model round's request is stored. The large system blocks (rules, schema document, registry) are identical across
 * thousands of rounds, so they are kept once in ops.prompt_blocks by content hash and a round references them; small
 * blocks (pins, dates, the critic's step summary) are inlined. 2 KB is the line: above it a block is almost certainly
 * shared, below it hashing would create one prompt_blocks row per round for nothing.
 */
export const BLOCK_MIN_BYTES = 2048;

export type StoredSystemBlock = { hash: string; bytes: number } | { text: string };
export type PromptBlock = { hash: string; text: string; bytes: number };

/** What the wrapper reports it sent, before storage. `system` is the block texts in order. */
export type LlmRequest = {
  model: string;
  max_tokens: number;
  effort: string;
  format: boolean;
  tools: string[] | null;
  system: string[];
  messages: unknown[];
};

/** The stored form: large system blocks by reference, the rest verbatim. */
export type StoredLlmRequest = Omit<LlmRequest, "system"> & { system: StoredSystemBlock[] };

export function blockHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function splitSystemBlocks(system: string[], minBytes = BLOCK_MIN_BYTES): { system: StoredSystemBlock[]; blocks: PromptBlock[] } {
  const blocks = new Map<string, PromptBlock>();
  const stored = system.map((text): StoredSystemBlock => {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes < minBytes) return { text };
    const hash = blockHash(text);
    blocks.set(hash, { hash, text, bytes });
    return { hash, bytes };
  });
  return { system: stored, blocks: [...blocks.values()] };
}

/** The inverse, for the trace reader: hashes back to text, from a map of the blocks fetched for the run. */
export function expandSystemBlocks(system: StoredSystemBlock[], texts: Record<string, string>): string[] {
  return system.map((b) => ("text" in b ? b.text : (texts[b.hash] ?? `[prompt block ${b.hash.slice(0, 12)} expired]`)));
}
