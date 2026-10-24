import { envBool, envInt, requireEnv } from "@ask-moov/db";

/** Server-side configuration, read on demand. Fail fast on anything missing. */
export const serverEnv = () => ({
  appUrl: requireEnv("APP_URL").replace(/\/$/, ""),
  workerSecret: requireEnv("WORKER_SECRET"),
  monthlyTokenBudget: envInt("MONTHLY_TOKEN_BUDGET", 5_000_000),
  runTokenCap: envInt("RUN_TOKEN_CAP", 150_000),
  episodesEnabled: envBool("EPISODES_ENABLED", true),
  chaosEnabled: envBool("CHAOS_ENABLED", false),
});
