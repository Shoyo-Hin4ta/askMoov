/** What a row-security policy's qual means for a reader, derived from its text by fixed rules so the raw qual can be checked against it. */
export const POLICY_LEGEND = "Teacher = own rosters and sections. Admin = own school. Super admin = all schools. Enforced in Postgres, never in a prompt.";

export function appliesTo(qual: string | null): string {
  const q = (qual ?? "").trim();
  if (q.includes("teacher")) return "Teacher";
  if (q.includes("admin") && !q.includes("super_admin")) return "Admin";
  if (q.includes("super_admin") && q.includes("school_id") && q.includes("current_setting('app.school_id'")) return "Every role within its school, Super admin everywhere";
  if (q.includes("super_admin")) return "Super admin";
  if (q.includes("app.user_id")) return "The user who asked (history)";
  if (q === "true") return "App role, no row filter";
  if (q.includes("runs")) return "Through the user's own runs (history)";
  return "No role condition";
}
