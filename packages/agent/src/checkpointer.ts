import type pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * Thread memory lives in schema langgraph (migration 20261022023007). setup() is a no-op there because every version is pre-recorded.
 * It runs on the app role's shared pool: fromConnString opened a second pool with pg's default of 10 connections, so one
 * Vercel instance could hold 14 of the pooler's 15 app-role slots (2026-10-25, every question failing with EMAXCONNSESSION).
 */
export function createCheckpointer(pool: pg.Pool): PostgresSaver {
  return new PostgresSaver(pool, undefined, { schema: "langgraph" });
}
