import { execSync } from "node:child_process";

let cached: string | undefined;

/** Vercel sets VERCEL_GIT_COMMIT_SHA; locally fall back to git. Recorded on every run and model call. */
export function gitSha(): string {
  if (cached) return cached;
  cached = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!cached) {
    try { cached = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
    catch { cached = "unknown"; }
  }
  return cached;
}
