/** Deterministic PRNG (mulberry32) and the few distributions the seed needs. Same seed, same data, byte for byte. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Uniform [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  uniform(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from empty list");
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  /** Fisher-Yates, returns a new array. */
  shuffle<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
  sample<T>(xs: readonly T[], n: number): T[] {
    return this.shuffle(xs).slice(0, n);
  }
  /** Standard normal via Box-Muller. */
  normal(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Log-normal with the given median and sigma, clamped. */
  lognormal(median: number, sigma: number, lo: number, hi: number): number {
    const x = median * Math.exp(sigma * this.normal());
    return Math.min(hi, Math.max(lo, x));
  }
  /** A child generator for a sub-stream, so adding a feature does not reshuffle everything else. */
  fork(label: string): Rng {
    let h = 2166136261 >>> 0;
    for (const ch of label) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return new Rng((this.s ^ h) >>> 0);
  }
}
