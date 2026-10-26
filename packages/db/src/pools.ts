import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";
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

/**
 * At most 4 clients, idle ones closed after 5 s, none older than 60 s. On Vercel a suspended instance's timers stop and its
 * open sockets held the session pooler's slots (2026-10-25: 15 of 15 app-role slots idle for 17 minutes, every question
 * failing with EMAXCONNSESSION). attachDatabasePool keeps the instance awake past the idle timeout after a release, but pg
 * reports a plain pool.query's release under the request that opened the connection, so that is best effort; the 60 s
 * lifetime bounds the rest. Deploy against the transaction pooler (port 6543), where an idle socket holds no database
 * connection. Outside Vercel the hook does nothing. An idle client the pooler drops emits 'error'; unhandled, it kills the process.
 */
function runtimePool(connectionString: string): pg.Pool {
  const pool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 5_000, maxLifetimeSeconds: 60 });
  pool.on("error", (e) => console.error(`pg pool: idle client error: ${e.message}`));
  attachDatabasePool(pool);
  return pool;
}

export function getAppPool(): pg.Pool {
  appPool ??= runtimePool(requireEnv("DATABASE_URL_APP"));
  return appPool;
}

export function getQueryPool(): pg.Pool {
  queryPool ??= runtimePool(requireEnv("DATABASE_URL_QUERY"));
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
