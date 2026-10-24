import { execSync } from "node:child_process";

/**
 * Vercel sets VERCEL_GIT_COMMIT_SHA, fixed for the life of a deployment. Locally the sha is read from git on every call
 * (a few milliseconds) rather than cached: a dev server that has run for days must stamp the commit that is checked out
 * now, not the one it started on (2026-10-24: two days of local runs carried the first commit's sha).
 */
export function gitSha(): string {
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercel) return vercel;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "unknown"; }
}
