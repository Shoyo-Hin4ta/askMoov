import type { Persona } from "./persona";

/**
 * The three demo personas. The browser sends a key; the server maps it to the real tuple.
 * Nothing about a persona is ever trusted from the request body.
 */
export const PERSONA_KEYS = ["teacher", "admin", "super_admin"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export const PERSONAS: Record<PersonaKey, Persona & { label: string }> = {
  teacher: { role: "teacher", user_id: 12, school_id: 1, scope_summary: "Edna Krabappel, teacher at Springfield High", label: "Teacher: Edna Krabappel" },
  admin: { role: "admin", user_id: 1001, school_id: 1, scope_summary: "Seymour Skinner, principal of Springfield High", label: "Admin: Seymour Skinner" },
  super_admin: { role: "super_admin", user_id: 9001, school_id: 1, scope_summary: "Gary Chalmers, district superintendent", label: "District: Gary Chalmers" },
};

/** The tuple the server trusts for a persona key: the four fields the agent and the database read, never the display label. */
export function personaFor(key: PersonaKey): Persona {
  const p = PERSONAS[key];
  return { role: p.role, user_id: p.user_id, school_id: p.school_id, scope_summary: p.scope_summary };
}
