import { describe, expect, it } from "vitest";
import { isSummable, seriesColumn, stepFacts } from "./facts";

describe("stepFacts", () => {
  it("a time series gets first, last, peak and low; the total is a sum of counts", () => {
    const rows = [
      { minute_bucket: "07:30", value: 667 }, { minute_bucket: "07:35", value: 700 }, { minute_bucket: "07:40", value: 720 },
      { minute_bucket: "07:45", value: 800 }, { minute_bucket: "07:50", value: 1400 }, { minute_bucket: "07:55", value: 1390 }, { minute_bucket: "08:00", value: 300 },
    ];
    const f = stepFacts(["minute_bucket", "value"], rows, "series", true);
    expect(f.value_column).toBe("value");
    expect(f.first).toEqual(rows[0]);
    expect(f.last).toEqual(rows[6]);
    expect(f.max).toEqual({ minute_bucket: "07:50", value: 1400 });
    expect(f.min).toEqual({ minute_bucket: "08:00", value: 300 });
    expect(f.total).toBe(5977);
    expect(f.top_per_series).toBeUndefined();
  });

  it("an average over time gets no total", () => {
    const f = stepFacts(["week", "value"], [{ week: "2026-09-07", value: 5 }, { week: "2026-09-14", value: 9 }], "series", false);
    expect(f.total).toBeUndefined();
    expect(f.max).toEqual({ week: "2026-09-14", value: 9 });
  });

  it("a grouped result names the series column, the top row per series and the empty dimension count", () => {
    const rows = [
      { period: 6, wing: "East", value: 3359 }, { period: 6, wing: "West", value: 1322 }, { period: 1, wing: "East", value: 900 },
      { period: 1, wing: "West", value: 800 }, { period: 2, wing: "East", value: 700 }, { period: 2, wing: "West", value: 600 },
      { period: 6, wing: null, value: 120 }, { period: 1, wing: null, value: 30 },
    ];
    const f = stepFacts(["period", "wing", "value"], rows, "grouped", true);
    expect(f.series_column).toBe("wing"); // 3 periods vs 3 wings: a tie, and the non-numeric dimension is the series
    expect(f.top_per_series).toEqual({ East: rows[0], West: rows[1], "(none)": rows[6] });
    expect(f.empty).toEqual({ wing: 2 });
    expect(f.max).toEqual(rows[0]);
  });

  it("the series is the dimension with fewer distinct values; ties go to the non-numeric one, then the second column", () => {
    const eightPeriods = Array.from({ length: 8 }, (_, i) => ["East", "West"].map((w) => ({ period: i + 1, wing: w, value: i }))).flat();
    expect(seriesColumn(["period", "wing"], eightPeriods)).toBe("wing");
    expect(seriesColumn(["wing", "period"], eightPeriods)).toBe("wing");
    expect(seriesColumn(["destination", "wing"], [{ destination: "bathroom", wing: "East", value: 1 }, { destination: "nurse", wing: "West", value: 2 }])).toBe("wing");
  });

  it("an id column is never taken as the value even when it is the only number", () => {
    const f = stepFacts(["student_id", "pass_count"], [{ student_id: 1203, pass_count: 7 }, { student_id: 1204, pass_count: 2 }], "rows", false);
    expect(f.value_column).toBe("pass_count");
    expect(f.max).toEqual({ student_id: 1203, pass_count: 7 });
  });

  it("categories: max and min rows, no first/last", () => {
    const f = stepFacts(["student", "value"], [{ student: "Ana (1082)", value: 66.5 }, { student: "Bo (1090)", value: 12 }], "categories", true);
    expect(f.max).toEqual({ student: "Ana (1082)", value: 66.5 });
    expect(f.min).toEqual({ student: "Bo (1090)", value: 12 });
    expect(f.first).toBeUndefined();
  });

  it("rows without a numeric column carry only the empty-dimension counts", () => {
    const f = stepFacts(["student_id", "location", "arrived_at"], [{ student_id: 1, location: "Gym", arrived_at: "x" }, { student_id: 2, location: null, arrived_at: "y" }], "rows", false);
    expect(f.value_column).toBeNull();
    expect(f.empty).toEqual({ location: 1 });
    expect(f.max).toBeUndefined();
  });

  it("no rows, no facts beyond the value column", () => {
    expect(stepFacts(["value"], [], "scalar", true)).toEqual({ value_column: "value" });
  });
});

describe("isSummable", () => {
  it("counts and sums are, averages, rates and distinct counts are not", () => {
    expect(isSummable("count(*)::int")).toBe(true);
    expect(isSummable("(count(*) filter (where status = 'absent'))::int")).toBe(true);
    expect(isSummable("coalesce(sum(extract(epoch from (left_by - arrived_at)) / 60.0), 0)")).toBe(true);
    expect(isSummable("avg(case when status in ('present','tardy') then 1.0 else 0.0 end)")).toBe(false);
    expect(isSummable("count(distinct student_id)::int")).toBe(false);
    expect(isSummable(undefined)).toBe(false);
  });
});
