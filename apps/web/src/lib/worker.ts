import { executeRun, type RuntimeOptions } from "@ask-moov/agent";
import type { RunRow } from "@ask-moov/db";
import { serverEnv } from "./env";
import { gitSha } from "./git-sha";
import { pingWorker } from "./ping";

/** The worker route hands a claimed run to the shared runtime. Options come from env; a requeue pings the worker again. */
export function runClaimedRun(run: RunRow): Promise<unknown> {
  const env = serverEnv();
  const options: RuntimeOptions = {
    runTokenCap: env.runTokenCap,
    episodesEnabled: env.episodesEnabled,
    chaosEnabled: env.chaosEnabled,
    gitSha: gitSha(),
    onRequeue: pingWorker,
  };
  return executeRun(run, options);
}
