import { describe, expect, it } from "vitest";
import { callCursor, escapeLike, hrefWith, parseCallFilters, parseRunFilters, runCursor, runFilterParams, utcBounds } from "./ops-filters";

describe("parseRunFilters", () => {
  it("keeps known values, drops unknown ones, treats empty and repeated keys as the first or absent", () => {
    const f = parseRunFilters({ status: "failed", role: "teacher", source: "eval", path: "generated", sha: "F8D2DAA5", from: "2026-10-01", to: "2026-10-26", q: "  Bart  ", error: "1" });
    expect(f).toEqual({ status: "failed", role: "teacher", source: "eval", path: "generated", sha: "f8d2daa5", from: "2026-10-01", to: "2026-10-26", q: "Bart", error: true });
    expect(parseRunFilters({ status: "nope", role: "", source: ["all", "chat"], path: "x", sha: "zz", from: "2026-13-01", to: "2026-02-30", q: "", error: "yes" })).toEqual({ source: "all", error: false });
    expect(parseRunFilters({})).toEqual({ source: "chat", error: false });
    expect(parseRunFilters({ q: "a".repeat(300) }).q).toHaveLength(200);
  });
});

describe("parseCallFilters", () => {
  it("accepts node and model tokens, a uuid run id, and nothing else", () => {
    expect(parseCallFilters({ node: "plan", model: "claude-opus-5-5", error: "1", run: "2fa831eb-fb47-4831-ba68-b9069df10ab3" })).toEqual({ node: "plan", model: "claude-opus-5-5", error: true, run: "2fa831eb-fb47-4831-ba68-b9069df10ab3" });
    expect(parseCallFilters({ node: "plan; drop", model: "x y", run: "123" })).toEqual({ error: false });
  });
});

describe("cursors", () => {
  it("a run cursor is a uuid, a call cursor is digits", () => {
    expect(runCursor({ after: "2fa831eb-fb47-4831-ba68-b9069df10ab3" })).toBe("2fa831eb-fb47-4831-ba68-b9069df10ab3");
    expect(runCursor({ after: "12" })).toBeUndefined();
    expect(callCursor({ after: "12" })).toBe("12");
    expect(callCursor({ after: "2fa831eb-fb47-4831-ba68-b9069df10ab3" })).toBeUndefined();
  });
});

describe("utcBounds", () => {
  it("from at midnight UTC, to as the next day", () => {
    expect(utcBounds("2026-10-01", "2026-10-31")).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    expect(utcBounds(undefined, undefined)).toEqual({});
  });
});

describe("hrefWith", () => {
  it("omits defaults and absent values, carries the cursor, and round-trips", () => {
    const f = parseRunFilters({ status: "failed", q: "Bart %", source: "chat" });
    const href = hrefWith("/ops/runs", runFilterParams(f), "2fa831eb-fb47-4831-ba68-b9069df10ab3");
    expect(href).toBe("/ops/runs?status=failed&q=Bart+%25&after=2fa831eb-fb47-4831-ba68-b9069df10ab3");
    const sp = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(parseRunFilters(sp)).toEqual(f);
    expect(hrefWith("/ops/calls", {})).toBe("/ops/calls");
  });
});

describe("escapeLike", () => {
  it("escapes the three LIKE metacharacters", () => {
    expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
  });
});
