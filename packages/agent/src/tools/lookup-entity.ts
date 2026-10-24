import type { EntityType } from "@ask-moov/shared";

/**
 * Entity resolution (design doc 4.5a). The model says which words are a name and what constraints the sentence
 * carries; code decides everything after that. Scope is applied by RLS on analytics.v_entities before scoring,
 * so a teacher with one Bart on their rosters never sees a tie.
 */
export type ScopedQuery = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export type EntityMatch = { type: EntityType; id: number | string; label: string; detail: string; confidence: number };
export type ResolvedEntity = { type: EntityType; id: number | string; label: string; detail: string; text: string };

export type LookupFilters = { grade?: number; section_id?: number; teacher_id?: number; period?: number };

export type LookupResult =
  | { status: "resolved"; match: EntityMatch; candidates: EntityMatch[] }
  | { status: "ambiguous"; candidates: EntityMatch[] }
  | { status: "none"; candidates: [] };

export const EXACT_THRESHOLD = 0.95;
export const TIE_MARGIN = 0.1;
export const MIN_CONFIDENCE = 0.5; // below this a fuzzy match is noise, not a candidate: a full name that matches nobody is "none", not a clarification
/** A prefix or containment match scores at least this; anything lower owes its score to trigram similarity alone. */
export const RELATED_CONFIDENCE = 0.9;
const CANDIDATES = 5;
/** Not part of a name: "Ms. Krabappel" is Krabappel, which the containment rule then scores 0.9 instead of 0.556 of fuzzy text. */
const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|prof|coach)\.?\s+/i;
const PEOPLE = new Set<EntityType>(["student", "teacher"]);

export async function lookupEntity(
  query: ScopedQuery,
  pins: ResolvedEntity[],
  type: EntityType,
  text: string,
  filters: LookupFilters = {},
): Promise<LookupResult> {
  const needle = text.trim().replace(/\s+/g, " ").replace(PEOPLE.has(type) ? HONORIFIC : /$^/, "");
  if (!needle) return { status: "none", candidates: [] };

  const pinned = pins.find((p) => p.type === type && sameName(p.label, needle));
  if (pinned) {
    const match: EntityMatch = { type, id: pinned.id, label: pinned.label, detail: pinned.detail, confidence: 1 };
    return { status: "resolved", match, candidates: [match] };
  }

  // $1 is a bound parameter (never spliced into SQL); escaping %, _ and \ keeps it from acting as a LIKE pattern
  const likeSafe = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const params: unknown[] = [needle, type, likeSafe];
  const where: string[] = ["e.type = $2"];
  const hasFilters = Object.values(filters).some((v) => v !== undefined);
  if (filters.grade !== undefined) { params.push(filters.grade); where.push(`e.grade = $${params.length}`); }
  if (filters.section_id !== undefined) { params.push(filters.section_id); where.push(`EXISTS (SELECT 1 FROM analytics.v_section_roster r WHERE r.student_id = e.id::int AND r.section_id = $${params.length})`); }
  if (filters.teacher_id !== undefined) { params.push(filters.teacher_id); where.push(`EXISTS (SELECT 1 FROM analytics.v_section_roster r WHERE r.student_id = e.id::int AND r.teacher_id = $${params.length})`); }
  if (filters.period !== undefined) { params.push(filters.period); where.push(`e.period = $${params.length}`); }
  // "my 4th period": sections resolve through the roster view, which RLS already limits to the caller's own sections
  // (a teacher) or the school (an admin). The dimension table alone would show a teacher every section in the school.
  if (type === "section") where.push("EXISTS (SELECT 1 FROM analytics.v_section_roster r WHERE r.section_id = e.id::int)");

  // Confidence: exact label 1.0; the words start the label (a first name, "Entrance 2") 0.97; contained anywhere
  // (a last name) 0.9; the label contained in the words ("Room 214" -> "214") 0.9; otherwise trigram similarity. With the 0.95 exact threshold, "Nelson" resolves to Nelson Muntz
  // over Ana Nelson, while "Bart" still ties Bart Simpson with Bart Reyes and asks.
  const confidence = `greatest(similarity(e.search, $1),
    case when lower(e.label) = lower($1) then 1.0
         when lower(e.label) like lower($3) || '%' escape '\\' then 0.97
         when lower(e.label) like '%' || lower($3) || '%' escape '\\' then 0.9
         when length(e.label) >= 2 and lower($1) like '%' || lower(e.label) || '%' then 0.9
         else 0 end)`;
  const sql = (minConfidence: number) =>
    `SELECT type, id, label, detail, confidence FROM (
       SELECT e.type, e.id, e.label, e.detail, ${confidence} AS confidence
       FROM analytics.v_entities e
       WHERE ${where.join(" AND ")}
     ) scored
     WHERE confidence >= ${minConfidence}
     ORDER BY confidence DESC, label ASC
     LIMIT ${CANDIDATES}`;
  let rows = await query(sql(MIN_CONFIDENCE), params);
  // No name-like match but the question carried constraints ("my 4th period", "the freshman"): the constraints decide.
  if (rows.length === 0 && (hasFilters || type === "section")) rows = await query(sql(0), params);
  const candidates: EntityMatch[] = rows.map((r) => ({
    type, id: numericId(r["id"]), label: String(r["label"]), detail: String(r["detail"] ?? ""), confidence: Number(r["confidence"]),
  }));
  return decide(nameAgreement(type, needle, candidates));
}

/**
 * A full name that merely resembles someone is not that person. For people, when the user typed two or more words and a
 * candidate owes its score to trigram similarity alone (below RELATED_CONFIDENCE), its first name must equal the typed first
 * name. Measured 2026-10-24: "Nelson Muntz" vs "Mia Nelson" is 0.500, which a teacher who cannot see Nelson Muntz used to
 * get back as a resolved match; "Bart Simpsen" vs "Bart Simpson" is 0.625 and "Ralph Wigum" vs "Ralph Wiggum" 0.786, which
 * still resolve. Rooms, wings, sections and schools are not names and are left alone.
 */
export function nameAgreement(type: EntityType, needle: string, candidates: EntityMatch[]): EntityMatch[] {
  const words = norm(needle).split(/\s+/);
  if (!PEOPLE.has(type) || words.length < 2) return candidates;
  return candidates.filter((c) => c.confidence >= RELATED_CONFIDENCE || firstWord(c.label) === words[0]);
}

/** Pure tie logic, tested on its own. */
export function decide(candidates: EntityMatch[]): LookupResult {
  const [top, second] = candidates;
  if (!top) return { status: "none", candidates: [] };
  if (top.confidence >= EXACT_THRESHOLD && (!second || second.confidence < EXACT_THRESHOLD)) return { status: "resolved", match: top, candidates };
  if (second && top.confidence >= EXACT_THRESHOLD && second.confidence >= EXACT_THRESHOLD && top.confidence > second.confidence) return { status: "resolved", match: top, candidates }; // exact beats prefix
  if (second && top.confidence - second.confidence < TIE_MARGIN) return { status: "ambiguous", candidates };
  return { status: "resolved", match: top, candidates };
}

/** v_entities carries every id as text; numeric ones come back as numbers so compiled predicates bind cleanly. */
function numericId(v: unknown): number | string {
  const s = String(v);
  return /^\d+$/.test(s) ? Number(s) : s;
}

const norm = (s: string) => s.toLowerCase().trim();
const firstWord = (s: string) => norm(s).split(/\s+/)[0] ?? "";

/** Would this pin answer for `text`? The full label, or a bare first name ("Bart" hits "Bart Simpson"). */
export function sameName(label: string, text: string): boolean {
  const a = norm(label), b = norm(text);
  return a === b || firstWord(a) === b;
}

/**
 * The thread's pins while one run plans. `inherited` came from earlier runs; `added` were named in this run.
 * Eviction only touches `inherited`: two entities named in one question ("Room 214 and Room 118") must both survive,
 * because validatePlan accepts an id only if a lookup or a pin produced it in this run.
 */
export type PinSet = { inherited: ResolvedEntity[]; added: ResolvedEntity[] };

export const allPins = (set: PinSet): ResolvedEntity[] => [...set.inherited, ...set.added];

/**
 * Pin `next`. The same entity again is a no-op. An inherited pin of the same type that a bare name would confuse with
 * `next` (same first name: "Bart Simpson" then "Bart Reyes"; or it would have answered for the words the user typed)
 * is replaced, so "Bart" means the one the user named last (design 11.1).
 */
export function pinEntity(set: PinSet, next: ResolvedEntity): PinSet {
  if (allPins(set).some((p) => p.type === next.type && String(p.id) === String(next.id))) return set;
  const collides = (p: ResolvedEntity) => p.type === next.type && (firstWord(p.label) === firstWord(next.label) || sameName(p.label, next.text));
  return { inherited: set.inherited.filter((p) => !collides(p)), added: [...set.added, next] };
}

/**
 * A clarification chip answers the lookup it was clicked for. The chip's run re-asks the same question, so the planner
 * repeats the lookup that was ambiguous, often with no name at all ("my class"); a pinned section cannot match by name
 * the way a pinned student does, and the run looped back to the same chips (2026-10-24, run de9081cd). Rule: for a type
 * that is not a person, the first lookup of that type in the chip's run takes the chosen entity, provided every number in
 * the lookup text appears in the entity's label or detail ("my 6th period" does not take a period-4 chip; "Room 214" takes
 * room "214"). People keep matching by name only, so "Bart and Lisa" never hands Lisa's lookup Bart's chip.
 */
export function chosenFor(chosen: ResolvedEntity[], type: EntityType, text: string): ResolvedEntity | undefined {
  if (PEOPLE.has(type)) return undefined;
  const numbers = text.match(/\d+/g) ?? [];
  return chosen.find((p) => p.type === type && numbers.every((n) => `${p.label} ${p.detail}`.includes(n)));
}
