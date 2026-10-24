import { CalcError } from "../errors";

/**
 * The only arithmetic the agent does. Named formulas for the common cases, plus a sandboxed
 * expression mode for plain arithmetic over named numeric args. No I/O, no eval.
 *
 * value null means the formula has no value for these inputs (a zero baseline, a zero denominator, nothing to average)
 * and the explanation, which always names the inputs, is the result. CalcError is for plan mistakes only: an unknown
 * formula, a missing or non-numeric argument, a bad expression.
 */
export type CalcResult = { value: number | "unreachable" | null; explanation: string };

type Args = Record<string, number | number[]>;

function num(args: Args, name: string): number {
  const v = args[name];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new CalcError(`calc: argument "${name}" must be a finite number, got ${JSON.stringify(v)}`);
  return v;
}

function list(args: Args, name: string): number[] {
  const v = args[name];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    throw new CalcError(`calc: argument "${name}" must be a list of numbers`);
  }
  return v;
}

/** The signed delta for a change from zero: "+5", "-3". */
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export const FORMULAS: Record<string, (args: Args) => CalcResult> = {
  /** num / den. A zero denominator has no value; the explanation says so. */
  rate(args) {
    const n = num(args, "num"), d = num(args, "den");
    if (d === 0) return { value: null, explanation: `${n} / 0: a rate over a zero denominator has no value` };
    return { value: n / d, explanation: `${n} / ${d}` };
  },
  /** Relative change from before to after. Nothing before and nothing after is no change; something after nothing has no baseline. */
  change(args) {
    const b = num(args, "before"), a = num(args, "after");
    if (b === 0 && a === 0) return { value: 0, explanation: "0 before and 0 after: no change" };
    if (b === 0) return { value: null, explanation: `from 0 to ${a} (${signed(a)}); a relative change has no baseline at zero` };
    return { value: (a - b) / b, explanation: `(${a} - ${b}) / ${b}` };
  },
  /** Share of whole, 0 to 1. */
  pct_of(args) {
    const p = num(args, "part"), w = num(args, "whole");
    if (w === 0) return { value: null, explanation: `${p} of 0: a share of a zero whole has no value` };
    return { value: p / w, explanation: `${p} / ${w}` };
  },
  avg(args) {
    const xs = list(args, "values");
    if (xs.length === 0) return { value: null, explanation: "no values to average" };
    const s = xs.reduce((a, b) => a + b, 0);
    return { value: s / xs.length, explanation: `sum of ${xs.length} values / ${xs.length}` };
  },
  /**
   * How many more consecutive attended classes raise (attended / scheduled) to target,
   * assuming every future class is both scheduled and attended. "unreachable" when target > 1.
   */
  classes_to_target(args) {
    const attended = num(args, "attended"), scheduled = num(args, "scheduled"), target = num(args, "target");
    if (target > 1 || target < 0) return { value: "unreachable", explanation: `target ${target} is outside 0..1` };
    if (scheduled === 0) return { value: null, explanation: `${attended} attended of 0 scheduled: there is no attendance rate to raise` };
    if (attended / scheduled >= target) return { value: 0, explanation: "already at or above target" };
    if (target === 1) return { value: "unreachable", explanation: "a rate of 1 needs zero absences, which past absences make impossible" };
    // (attended + x) / (scheduled + x) >= target  =>  x >= (target*scheduled - attended) / (1 - target).
    // The division is done in floating point (1 - 0.9 is 0.0999...98, so 34 of 40 to 0.9 came out as 21, not 20): take the
    // estimate, then settle on the smallest integer that satisfies the inequality itself.
    const meets = (x: number): boolean => (attended + x) / (scheduled + x) >= target;
    let x = Math.max(0, Math.ceil((target * scheduled - attended) / (1 - target) - 1e-9));
    while (!meets(x)) x++;
    while (x > 0 && meets(x - 1)) x--;
    return { value: x, explanation: `smallest x with (${attended} + x) / (${scheduled} + x) >= ${target}` };
  },
};

export function calc(formula: string, args: Args): CalcResult {
  if (formula === "expr") {
    const src = (args as Record<string, unknown>)["expr"];
    if (typeof src !== "string") throw new CalcError("calc expr: args.expr must be a string");
    const vars: Record<string, number> = {};
    for (const [k, v] of Object.entries(args)) if (typeof v === "number") vars[k] = v;
    const value = evaluate(src, vars);
    if (value === null) {
      const bound = Object.entries(vars).map(([k, v]) => `${k} = ${v}`).join(", ");
      return { value: null, explanation: `${src}${bound ? ` with ${bound}` : ""}: division by zero, no value` };
    }
    return { value, explanation: src };
  }
  const f = FORMULAS[formula];
  if (!f) throw new CalcError(`calc: unknown formula "${formula}"; known: ${Object.keys(FORMULAS).join(", ")}, expr`);
  return f(args);
}

/* ---- sandboxed arithmetic: numbers, identifiers, + - * / ( ), unary minus. Nothing else. ---- */

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new CalcError(`calc expr: bad number at ${i}`);
      out.push({ t: "num", v }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ t: "id", v: src.slice(i, j) }); i = j; continue;
    }
    if ("+-*/()".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new CalcError(`calc expr: unexpected character "${c}" at ${i}`);
  }
  return out;
}

/**
 * Evaluates an expression over the given variables. Returns null for a division by zero: the parse runs to completion
 * first, so a syntax error (unknown variable, trailing input, missing paren) still throws CalcError ahead of it.
 */
export function evaluate(src: string, vars: Record<string, number>): number | null {
  const toks = tokenize(src);
  let p = 0;
  let divZero = false;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expr = (): number => {
    let v = term();
    while (peek()?.t === "op" && (peek() as Tok & { t: "op" }).v.match(/[+-]/)) {
      const op = (take() as Tok & { t: "op" }).v; const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (peek()?.t === "op" && (peek() as Tok & { t: "op" }).v.match(/[*/]/)) {
      const op = (take() as Tok & { t: "op" }).v; const r = unary();
      if (op === "/" && r === 0) { divZero = true; v = NaN; }
      else v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number => {
    const t = peek();
    if (t?.t === "op" && t.v === "-") { take(); return -unary(); }
    return atom();
  };
  const atom = (): number => {
    const t = take();
    if (!t) throw new CalcError("calc expr: unexpected end");
    if (t.t === "num") return t.v;
    if (t.t === "id") {
      if (!(t.v in vars)) throw new CalcError(`calc expr: unknown variable "${t.v}"; known: ${Object.keys(vars).join(", ") || "none"}`);
      return vars[t.v]!;
    }
    if (t.v === "(") { const v = expr(); const c = take(); if (!c || c.t !== "op" || c.v !== ")") throw new CalcError("calc expr: missing )"); return v; }
    throw new CalcError(`calc expr: unexpected "${t.v}"`);
  };
  const v = expr();
  if (p !== toks.length) throw new CalcError("calc expr: trailing input");
  if (divZero) return null;
  if (!Number.isFinite(v)) throw new CalcError("calc expr: result is not finite");
  return v;
}
