/**
 * One-time setup after `npm run db:push`:
 *  1. give ask_moov_app / ask_moov_query a password and LOGIN
 *  2. write DATABASE_URL_APP / DATABASE_URL_QUERY into .env (same host as DATABASE_URL_ADMIN)
 *  3. store APP_URL and WORKER_SECRET in Supabase Vault for ops.redispatch()
 * Idempotent: re-running rotates the role passwords and rewrites the secrets.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { getAdminPool, requireEnv } from "./index";

const ENV_PATH = new URL("../../../.env", import.meta.url);

async function main(): Promise<void> {
  const admin = getAdminPool();
  const adminUrl = new URL(requireEnv("DATABASE_URL_ADMIN"));
  const appUrl = requireEnv("APP_URL");
  const workerSecret = requireEnv("WORKER_SECRET");

  const passwords: Record<string, string> = {};
  for (const role of ["ask_moov_app", "ask_moov_query"]) {
    const pw = randomBytes(24).toString("base64url");
    passwords[role] = pw;
    // role names are fixed identifiers; the password is a literal, so quote it
    await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${pw.replace(/'/g, "''")}'`);
  }

  for (const [name, value] of [["app_url", appUrl], ["worker_secret", workerSecret]] as const) {
    await admin.query("DELETE FROM vault.secrets WHERE name = $1", [name]);
    await admin.query("SELECT vault.create_secret($1, $2)", [value, name]);
  }
  await admin.end();

  const urlFor = (role: string) => {
    const u = new URL(adminUrl.toString());
    // pooler usernames carry the project ref: postgres.<ref> -> <role>.<ref>; direct host is the bare role
    u.username = adminUrl.username.includes(".") ? `${role}.${adminUrl.username.split(".")[1]}` : role;
    u.password = encodeURIComponent(passwords[role]!);
    return u.toString();
  };

  let env = readFileSync(ENV_PATH, "utf8");
  env = env.replace(/^DATABASE_URL_APP=.*$/m, `DATABASE_URL_APP=${urlFor("ask_moov_app")}`);
  env = env.replace(/^DATABASE_URL_QUERY=.*$/m, `DATABASE_URL_QUERY=${urlFor("ask_moov_query")}`);
  writeFileSync(ENV_PATH, env);
  console.log("roles updated, vault secrets stored, .env rewritten (DATABASE_URL_APP, DATABASE_URL_QUERY)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
