import pg from "pg";
import type { Persona } from "@ask-moov/shared";
import { requireEnv } from "./env";

const { Pool, types } = pg;

// Postgres returns numeric and bigint as strings. Every number that reaches the agent (counts, averages, calc inputs)
// comes through these pools, so parse them once here. Ids and counts in this data fit comfortably in a double.
types.setTypeParser(types.builtins.NUMERIC, (v) => parseFloat(v));
types.setTypeParser(types.builtins.INT8, (v) => parseInt(v, 10));
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/**
 * Two pools, two roles.
 * app:   ops.*, memory.*, langgraph.* read/write. No access to analytics.
 * query: SELECT on analytics.* only, 5s statement timeout, read-only. Scoped per transaction by withScope().
 */
let appPool: pg.Pool | undefined;
let queryPool: pg.Pool | undefined;

export function getAppPool(): pg.Pool {
  appPool ??= new Pool({ connectionString: requireEnv("DATABASE_URL_APP"), max: 4 });
  return appPool;
}

export function getQueryPool(): pg.Pool {
  queryPool ??= new Pool({ connectionString: requireEnv("DATABASE_URL_QUERY"), max: 4 });
  return queryPool;
}

/** Superuser pool for migrations and seeding only. Never used by the app at runtime. */
export function getAdminPool(): pg.Pool {
  return new Pool({ connectionString: requireEnv("DATABASE_URL_ADMIN"), max: 2 });
}

/**
 * Run fn inside one transaction on the query pool with the caller's scope set as session variables.
 * RLS policies read app.role, app.user_id, app.school_id. Without this call, every view returns zero rows.
 */
export async function withScope<T>(pool: pg.Pool, persona: Persona, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(
      "SELECT set_config('app.role', $1, true), set_config('app.user_id', $2, true), set_config('app.school_id', $3, true)",
      [persona.role, String(persona.user_id), String(persona.school_id)],
    );
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([appPool?.end(), queryPool?.end()]);
  appPool = undefined;
  queryPool = undefined;
}
