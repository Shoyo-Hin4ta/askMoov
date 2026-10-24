import { PERSONAS, type PersonaKey } from "@ask-moov/shared";

/** "Teacher: Edna Krabappel" as its two parts. */
export function personaParts(key: PersonaKey): { role: string; name: string } {
  const [role, name] = PERSONAS[key].label.split(": ");
  return { role: role ?? PERSONAS[key].label, name: name ?? PERSONAS[key].label };
}

export function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}
