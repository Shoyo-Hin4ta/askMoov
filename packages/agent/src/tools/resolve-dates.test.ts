import { describe, expect, it } from "vitest";
import { everyDay, resolveDates, DateResolutionError } from "./resolve-dates";

const TODAY = "2026-10-13"; // Tuesday
// school days: every weekday from Sep 1 to Oct 13, minus a break Oct 5..9
const schoolDays = async (start: string, end: string) => {
  const out: string[] = [];
  for (let d = new Date(start + "T00:00:00Z"); d <= new Date(end + "T00:00:00Z"); d = new Date(d.getTime() + 86_400_000)) {
    const s = d.toISOString().slice(0, 10);
    const dow = ((d.getUTCDay() + 6) % 7) + 1;
    if (dow <= 5 && s >= "2026-09-01" && !(s >= "2026-10-05" && s <= "2026-10-09")) out.push(s);
  }
  return out;
};
const r = (q: Record<string, unknown>) => resolveDates({ phrase: "x", ...q }, TODAY, schoolDays);

describe("resolve_dates", () => {
  it("today / yesterday is the last school day", async () => {
    expect(await r({ kind: "today" })).toMatchObject({ start: "2026-10-13", end: "2026-10-13" });
    expect(await r({ kind: "yesterday" })).toMatchObject({ start: "2026-10-12", end: "2026-10-12" });
  });
  it("this week is Monday to today", async () => {
    expect(await r({ kind: "relative", unit: "week", anchor: "this" })).toMatchObject({ start: "2026-10-12", end: "2026-10-13" });
  });
  it("last week over a break has no school days and says so", async () => {
    await expect(r({ kind: "relative", unit: "week", anchor: "last", count: 1 })).rejects.toBeInstanceOf(DateResolutionError);
  });
  it("last 2 weeks clips to school days", async () => {
    expect(await r({ kind: "relative", unit: "week", anchor: "last", count: 2 })).toMatchObject({ start: "2026-09-28", end: "2026-10-02", label: "last 2 weeks" });
  });
  it("last 7 days includes today", async () => {
    expect(await r({ kind: "relative", unit: "day", anchor: "last", count: 7 })).toMatchObject({ start: "2026-10-12", end: "2026-10-13" });
  });
  it("a named month defaults to the current school year", async () => {
    expect(await r({ kind: "month", month: 9 })).toMatchObject({ start: "2026-09-01", end: "2026-09-30", label: "September 2026" });
  });
  it("weekday filter: Tuesdays in September", async () => {
    const out = await r({ kind: "month", month: 9, weekdays: [2] });
    expect(out).toMatchObject({ start: "2026-09-01", end: "2026-09-29", day_of_week: [2] });
  });
  it("range never runs past today", async () => {
    expect(await r({ kind: "range", start: "2026-10-01", end: "2026-10-31" })).toMatchObject({ start: "2026-10-01", end: "2026-10-13" });
  });
  it("rejects malformed input before any math", async () => {
    await expect(r({ kind: "since", start: "Sept 1" })).rejects.toBeInstanceOf(DateResolutionError);
    await expect(r({ kind: "range", start: "2026-10-13", end: "2026-10-01" })).rejects.toBeInstanceOf(DateResolutionError);
  });
});

describe("everyDay (history clock)", () => {
  it("returns every calendar day, weekends included, so history questions are not clipped to school days", async () => {
    expect(await everyDay("2026-10-09", "2026-10-12")).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
  });
  it("last week against the real clock resolves to seven calendar days", async () => {
    const out = await resolveDates({ phrase: "last week", kind: "relative", unit: "week", anchor: "last", clock: "history" }, "2026-10-22", everyDay);
    expect(out).toMatchObject({ start: "2026-10-12", end: "2026-10-18", label: "last week" });
  });
});
