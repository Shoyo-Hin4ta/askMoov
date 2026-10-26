import { describe, expect, it } from "vitest";
import { allowedFrom, extractNumbers, proseMismatch } from "./prose";

/** Design 4.9: every number the presenter writes is a rounding of a number it was shown. The inputs below are real prompt fragments from 2026-10-26 runs. */

const ok = (texts: string[], sources: string[]) => expect(proseMismatch(texts, allowedFrom(sources))).toBeNull();
const bad = (texts: string[], sources: string[], ...offenders: string[]) => expect(proseMismatch(texts, allowedFrom(sources))).toBe(`not in the results: ${offenders.join(", ")}`);

describe("extractNumbers", () => {
  const nums = (t: string) => extractNumbers(t).numbers.map((n) => [n.raw, n.value, n.decimals, n.percent]);
  const times = (t: string) => extractNumbers(t).times.map((c) => [c.raw, c.minutes]);

  it("thousands groups are exactly three digits; id lists and short lists stay separate numbers", () => {
    expect(nums("3,359 passes")).toEqual([["3,359", 3359, 0, false]]);
    expect(nums("ids 1203,1204")).toEqual([["1203", 1203, 0, false], ["1204", 1204, 0, false]]);
    expect(nums("1, 2, 3")).toEqual([["1", 1, 0, false], ["2", 2, 0, false], ["3", 3, 0, false]]);
    expect(nums("1,2034")).toEqual([["1", 1, 0, false], ["2034", 2034, 0, false]]);
  });

  it("a sentence-final point is not a decimal; an en dash and a hyphen are not signs", () => {
    expect(nums("attended 275.")).toEqual([["275", 275, 0, false]]);
    expect(nums("Oct 1–13 and 1-13")).toEqual([["1", 1, 0, false], ["13", 13, 0, false], ["1", 1, 0, false], ["13", 13, 0, false]]);
  });

  it("percent marks: the sign, the word, percentage points", () => {
    expect(nums("92.1% and 89.8 percent and 2.3 percentage points")).toEqual([["92.1%", 92.1, 1, true], ["89.8 percent", 89.8, 1, true], ["2.3 percentage points", 2.3, 1, true]]);
  });

  it("ordinals, markdown bold and list markers", () => {
    expect(nums("4th period, the 21st, the 13th")).toEqual([["4", 4, 0, false], ["21", 21, 0, false], ["13", 13, 0, false]]);
    expect(nums("took **8** passes")).toEqual([["8", 8, 0, false]]);
    expect(nums("1. Springfield\n2. Shelbyville")).toEqual([]);
  });

  it("clock times are one token each, in minutes of the day, bare hours reading both ways", () => {
    expect(times("the 9:00 hour")).toEqual([["9:00", [540, 1260]]]);
    expect(times("at 2:10 pm and 12:05 a.m. and 12:10 PM and 14:10")).toEqual([["2:10 pm", [850]], ["12:05 a.m.", [5]], ["12:10 PM", [730]], ["14:10", [850]]]);
    expect(nums("the 9:00 hour")).toEqual([]);
  });

  it("an ISO datetime yields its date parts as numbers and its clock as a time", () => {
    const t = "\"hour\":\"2026-10-06T09:00:00.000Z\"";
    expect(times(t)).toEqual([["09:00", [540, 1260]]]);
    expect(nums(t)).toEqual([["2026", 2026, 0, false], ["10", 10, 0, false], ["06", 6, 0, false]]);
  });

  it("an hour bucket integer is also the time H:00, which a bare 9:00 in prose then matches", () => {
    const allowed = allowedFrom(["{\"hour_bucket\":9,\"value\":0.83}"]);
    expect([...allowed.times]).toEqual([540]);
    expect(proseMismatch(["in the 9:00 hour"], allowed)).toBeNull();
  });
});

describe("proseMismatch: rounding at the written precision, sign ignored, rates as percentages", () => {
  it("accepts roundings of a shown value at any written precision", () => {
    ok(["a relative change of -0.025"], ["value: -0.025120482"]);
    ok(["92.8% and 93% and 0.93"], ["value: 0.9281437125748503"]);
    ok(["4.8 minutes, or 4.82"], ["value: 4.816666"]);
    ok(["a drop of 85.7%"], ["value: -0.857142857"]);
    ok(["0.3"], ["value: 0.30000000000000004"]);
    ok(["3 passes, or 2"], ["value: 2.5"]);
    ok(["92.1%"], ["\"pct\":92.13"]);
  });

  it("rejects numbers the model computed", () => {
    bad(["Shelbyville is 2.3 percentage points behind Springfield"], ["value: 0.9213483", "value: 0.8982035", "value: -0.025120", "\"start\":\"2026-10-01\",\"end\":\"2026-10-13\""], "2.3 percentage points");
    bad(["students spent 1,533 hours in the Gym"], ["value: 91984"], "1,533");
    bad(["about 2,500 passes"], ["\"total\":2487"], "2,500");
    bad(["October 14"], ["\"start\":\"2026-10-01\",\"end\":\"2026-10-13\""], "14");
  });

  it("the SQL text and the limit are not sources, so their constants do not excuse a number", () => {
    bad(["about 60 minutes"], ["\"total\":58"], "60");
    bad(["100 students"], ["row_count: 37"], "100");
  });

  it("times: 24-hour and 12-hour readings of a shown time match; a derived end hour and a shifted hour do not", () => {
    ok(["in the 9:00 hour, 83.3% online"], ["{\"hour_bucket\":9,\"online_ratio\":0.8333}"]);
    ok(["2:10 pm, that is 14:10"], ["\"arrived_at\":\"2026-10-12T14:10:00.000Z\""]);
    ok(["12:10 pm and 12:05 am"], ["T12:10 \"2026-10-12T00:05:00.000Z\" \"2026-10-12T12:10:00.000Z\""]);
    ok(["7:50 and 9:00"], ["\"minute_bucket\":\"07:50\"", "\"hour\":\"2026-10-06T09:00:00.000Z\""]);
    bad(["online from 8:00 to 15:00"], ["{\"hour_bucket\":8},{\"hour_bucket\":14}"], "15:00");
    bad(["at 10:10 am"], ["\"2026-10-12T14:10:00.000Z\""], "10:10 am");
  });

  it("no numbers at all is fine; each offender is named once", () => {
    ok(["Nothing to report."], []);
    bad(["42 and again 42 and 7"], ["value: 1"], "42", "7");
  });
});

describe("proseMismatch on real answers from 2026-10-26", () => {
  it("school comparison", () => {
    ok(
      ["From October 1 to October 13, 2026, Springfield High had an attendance rate of 92.1%, compared with 89.8% at Shelbyville High. Shelbyville High's rate is about 2.5% lower, a relative change of -0.025.", "Relative change in attendance rate: Shelbyville vs Springfield, Oct 1–13 2026"],
      ["Compare attendance rates between Springfield High and Shelbyville High this month", "- school 1: Springfield High\n- school 2: Shelbyville High", "spec: {\"metric\":\"attendance_rate\",\"entity\":{\"type\":\"school\",\"id\":1},\"time_range\":{\"start\":\"2026-10-01\",\"end\":\"2026-10-13\"}}", "value: 0.9213483146067416", "value: 0.8982035928143712", "value: -0.025120 ((0.8982035928143712 - 0.9213483146067416) / 0.9213483146067416)"],
    );
  });

  it("Lisa's target", () => {
    ok(
      ["From August 19 to October 13, 2026, Lisa Simpson attended 269 of her 275 scheduled classes. To reach a 98% attendance rate, she needs to attend the next 25 classes in a row."],
      ["How many more classes does Lisa Simpson need to attend to reach a 98% attendance rate for this school year?", "- student 1205: Lisa Simpson (grade 10)", "\"time_range\":{\"start\":\"2026-08-19\",\"end\":\"2026-10-13\"}", "value: 269", "value: 275", "formula: classes_to_target args: [{\"name\":\"attended\",\"value\":\"$a.value\"},{\"name\":\"scheduled\",\"value\":\"$b.value\"},{\"name\":\"target\",\"value\":0.98}]", "value: 25"],
    );
  });

  it("Bart's tardies, with the weekly series", () => {
    ok(
      ["He had 1 tardy so far this month (October 1–13, 2026), compared with 7 last month (September 1–30, 2026), a drop of 85.7%. They fell from 5 in the week of September 21 to 2 in the week of September 28, then to 1 in the week of October 5.", "Bart Simpson's weekly tardies, Sep 1 – Oct 13, 2026"],
      ["- student 1203: Bart Simpson (grade 9)", "\"time_range\":{\"start\":\"2026-10-01\",\"end\":\"2026-10-13\"}", "\"time_range\":{\"start\":\"2026-09-01\",\"end\":\"2026-09-30\"}", "value: 1", "value: 7", "value: -0.8571428571428571", "sample_rows: [{\"week\":\"2026-09-21T00:00:00.000Z\",\"value\":5},{\"week\":\"2026-09-28T00:00:00.000Z\",\"value\":2},{\"week\":\"2026-10-05T00:00:00.000Z\",\"value\":1}]"],
    );
  });

  it("Milhouse, the East wing, Room 214 and the classes-to-target arithmetic shown by the calc", () => {
    ok(["Milhouse Van Houten took **8** bathroom passes during 4th period this month, from October 1 to October 13, 2026."], ["How many bathroom passes did Milhouse take during 4th period this month?", "\"filters\":{\"destination\":\"bathroom\",\"period\":4},\"time_range\":{\"start\":\"2026-10-01\",\"end\":\"2026-10-13\"}", "value: 8"]);
    ok(["There were 3,359 bathroom passes from the East wing during 6th period this month."], ["\"period\":6", "value: 3359"]);
    ok(["In the 9:00 hour it was online 83.3% of the time with 10 offline minutes, and in the 10:00 hour it was online 66.7% of the time with 20 offline minutes."], ["sample_rows: [{\"hour_bucket\":9,\"online_ratio\":0.8333333333333334,\"offline_minutes\":10},{\"hour_bucket\":10,\"online_ratio\":0.6666666666666666,\"offline_minutes\":20}]"]);
    ok(["he would need to attend 32 more classes in a row; (4 + 32) / (8 + 32) reaches 0.9"], ["value: 4", "value: 8", "\"target\",\"value\":0.9", "value: 32"]);
  });
});
