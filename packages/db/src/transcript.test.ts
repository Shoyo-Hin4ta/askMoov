import { describe, expect, it } from "vitest";
import { blockHash, expandSystemBlocks, splitSystemBlocks } from "./transcript";

describe("splitSystemBlocks", () => {
  const big = "schema ".repeat(400); // 2800 bytes
  const small = "Now: 2026-10-13T10:40:00Z";

  it("stores a large block by hash and inlines a small one, in order", () => {
    const { system, blocks } = splitSystemBlocks([big, small]);
    expect(system).toEqual([{ hash: blockHash(big), bytes: 2800 }, { text: small }]);
    expect(blocks).toEqual([{ hash: blockHash(big), text: big, bytes: 2800 }]);
  });

  it("the same large block twice is one prompt block", () => {
    const { blocks } = splitSystemBlocks([big, small, big]);
    expect(blocks).toHaveLength(1);
  });

  it("the hash is the sha256 of the text, so the same text anywhere maps to the same row", () => {
    expect(blockHash("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });

  it("expands hashes back to text and says so when a block has expired", () => {
    const { system } = splitSystemBlocks([big, small]);
    expect(expandSystemBlocks(system, { [blockHash(big)]: big })).toEqual([big, small]);
    expect(expandSystemBlocks(system, {})[0]).toMatch(/^\[prompt block [0-9a-f]{12} expired\]$/);
  });
});
