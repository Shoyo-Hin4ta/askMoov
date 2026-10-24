import { z } from "zod";

export const Role = z.enum(["teacher", "admin", "super_admin"]);
export type Role = z.infer<typeof Role>;

/** Who is asking. Set by code from the request, never by the model. */
export const Persona = z.object({
  role: Role,
  user_id: z.number().int(),
  school_id: z.number().int(),
  /** Human-readable scope, e.g. "Edna Krabappel, teaches sections 4B, 5A, 6C at Springfield High". Prompt courtesy only. */
  scope_summary: z.string(),
  /** Demo-only: crash the worker after this node on attempt 1. Ignored unless CHAOS_ENABLED=true. */
  chaos: z.object({ crash_after: z.string() }).optional(),
});
export type Persona = z.infer<typeof Persona>;
