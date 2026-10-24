import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePools, getAppPool } from "@ask-moov/db";
import { POST } from "./route";

/** Design 4.13 and 10: the monthly budget is checked before a run exists. Real database, no model call. */
describe("/api/ask budget", () => {
  afterAll(closePools);

  it("over the monthly token budget returns 429 with the numbers and inserts no run", async () => {
    const previous = process.env["MONTHLY_TOKEN_BUDGET"];
    process.env["MONTHLY_TOKEN_BUDGET"] = "1";
    const run_id = randomUUID();
    try {
      const res = await POST(new Request("http://localhost/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run_id, thread_id: "eval-budget-test", persona: "teacher", question: "How many passes did Bart take this month?" }),
      }));
      expect(res.status).toBe(429);
      const body = (await res.json()) as { error: string; used: number; budget: number };
      expect(body).toMatchObject({ error: "monthly token budget exhausted", budget: 1 });
      expect(body.used).toBeGreaterThanOrEqual(1);
      const n = (await getAppPool().query("select count(*)::int as n from ops.runs where id = $1", [run_id])).rows[0]!["n"];
      expect(n).toBe(0);
    } finally {
      if (previous === undefined) delete process.env["MONTHLY_TOKEN_BUDGET"];
      else process.env["MONTHLY_TOKEN_BUDGET"] = previous;
    }
  });

  it("a malformed body is a 400 before any budget or database work", async () => {
    const res = await POST(new Request("http://localhost/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: "teacher" }) }));
    expect(res.status).toBe(400);
  });
});
