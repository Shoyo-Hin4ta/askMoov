/** Fail fast on missing configuration. Every env read in the repo goes through here. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`env var ${name} must be an integer, got "${v}"`);
  return n;
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`env var ${name} must be "true" or "false", got "${v}"`);
}
