/**
 * Point the pg_cron re-dispatch at a deployment.
 *   npm run db:vault -- https://ask-moov.vercel.app
 * Writes two Supabase Vault secrets that ops.redispatch() reads every minute: app_url (the argument) and worker_secret
 * (WORKER_SECRET from .env, which must equal the value the deployment runs with). Unlike `npm run db:roles` this never
 * rotates a password or rewrites .env. Idempotent. Never prints a secret.
 */
import { getAdminPool, requireEnv } from "./index";

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) throw new Error("usage: npm run db:vault -- <public base url of the deployment>");
  let url: URL;
  try { url = new URL(arg); } catch { throw new Error(`not a URL: ${arg}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`app_url must be http(s), got ${url.protocol}`);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("app_url is a base URL: scheme and host only, no path");
  const appUrl = url.origin;
  const workerSecret = requireEnv("WORKER_SECRET");

  const admin = getAdminPool();
  try {
    for (const [name, value] of [["app_url", appUrl], ["worker_secret", workerSecret]] as const) {
      await admin.query("DELETE FROM vault.secrets WHERE name = $1", [name]);
      await admin.query("SELECT vault.create_secret($1, $2)", [value, name]);
    }
    const check = await admin.query("SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name IN ('app_url', 'worker_secret') ORDER BY name");
    const stored = Object.fromEntries(check.rows.map((r) => [String(r["name"]), String(r["decrypted_secret"])]));
    if (stored["app_url"] !== appUrl) throw new Error(`app_url read back as ${stored["app_url"] ?? "(missing)"}`);
    if (stored["worker_secret"] !== workerSecret) throw new Error("worker_secret did not read back as the value in .env");
    console.log(`vault: app_url = ${appUrl}; worker_secret set (${workerSecret.length} chars, matches .env). The cron posts stale runs to ${appUrl}/api/worker from the next minute.`);
  } finally {
    await admin.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
