import type { Critique, Plan, Role, Shape, Sketch } from "@ask-moov/shared";
import type { ResolvedEntity } from "./tools/lookup-entity";

/**
 * Episodic memory (design doc 11.2): what plans worked, keyed by metric + shape, trigram fill. No vectors, no names.
 */
export type AppQuery = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export type EpisodeRef = { id: number; question_templated: string; plan: Plan };

export const MAX_EPISODES = 3;
const MAX_TEMPLATED_LENGTH = 200;
const MIN_SIMILARITY = 0.3; // pg_trgm's default threshold; below it the trigram fill is noise

/** Only a person is still named by a first name alone. "Room" from "Room 214" is a common noun, not a name. */
const NAMED_BY_FIRST_NAME = new Set<ResolvedEntity["type"]>(["student", "teacher"]);

/**
 * Replace every resolved entity (its label, the text that matched it, and for a person a first name) and every date phrase
 * with a placeholder. One pass over the question with all forms alternated longest first: a token written by one
 * substitution can never be matched by a later one (the old per-form loop turned "Room 214" into "{{room}}" because "Room"
 * matched inside the token it had just written).
 */
export function templatize(question: string, entities: ResolvedEntity[], datePhrases: string[]): string {
  const subs: { text: string; token: string }[] = [];
  for (const e of entities) {
    const forms = [e.label, e.text];
    if (NAMED_BY_FIRST_NAME.has(e.type)) forms.push(e.label.split(/\s+/)[0] ?? "");
    for (const t of new Set(forms.map((f) => f.trim()))) if (t.length >= 2) subs.push({ text: t, token: `{${e.type}}` });
  }
  for (const d of datePhrases) if (d.trim()) subs.push({ text: d.trim(), token: "{date_range}" });
  let out = question;
  if (subs.length) {
    subs.sort((a, b) => b.text.length - a.text.length);
    const tokenFor = new Map(subs.map((s) => [s.text.toLowerCase(), s.token]));
    const pattern = new RegExp(`\\b(?:${subs.map((s) => escape(s.text)).join("|")})\\b`, "gi");
    out = out.replace(pattern, (m) => tokenFor.get(m.toLowerCase()) ?? m);
  }
  return out.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim().toLowerCase().slice(0, MAX_TEMPLATED_LENGTH);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function retrieveEpisodes(query: AppQuery, args: { sketch: Sketch; role: Role; questionTemplated: string; schemaVersion: string }): Promise<EpisodeRef[]> {
  const picked: EpisodeRef[] = [];
  if (args.sketch.metrics.length > 0) {
    const rows = await query(
      `SELECT id, question_templated, plan
       FROM memory.episodes
       WHERE metrics && $1::text[] AND shape = $2 AND role = $3 AND score >= 0
       ORDER BY (schema_version = $4) DESC, score DESC, created_at DESC
       LIMIT ${MAX_EPISODES}`,
      [args.sketch.metrics, args.sketch.shape, args.role, args.schemaVersion],
    );
    picked.push(...rows.map(toRef));
  }
  if (picked.length < MAX_EPISODES) {
    const rows = await query(
      `SELECT id, question_templated, plan
       FROM memory.episodes
       WHERE role = $1 AND score >= 0 AND NOT (id = ANY($2::bigint[])) AND similarity(question_templated, $3) >= $4
       ORDER BY similarity(question_templated, $3) DESC, score DESC, created_at DESC
       LIMIT ${MAX_EPISODES - picked.length}`,
      [args.role, picked.map((p) => p.id), args.questionTemplated, MIN_SIMILARITY],
    );
    picked.push(...rows.map(toRef));
  }
  return picked;
}

export async function writeEpisode(query: AppQuery, e: {
  role: Role; questionTemplated: string; plan: Plan; shape: Shape; critique: Critique | null; score: number; schemaVersion: string; gitSha: string;
}): Promise<number> {
  const metrics = [...new Set(e.plan.steps.flatMap((s) => (s.kind === "spec" ? [s.spec.metric] : [])))];
  const rows = await query(
    `INSERT INTO memory.episodes (role, question_templated, plan, metrics, shape, critique, score, schema_version, git_sha)
     VALUES ($1, $2, $3::jsonb, $4::text[], $5, $6::jsonb, $7, $8, $9) RETURNING id`,
    [e.role, e.questionTemplated, JSON.stringify(e.plan), metrics, e.shape, e.critique ? JSON.stringify(e.critique) : null, e.score, e.schemaVersion, e.gitSha],
  );
  return Number(rows[0]!["id"]);
}

/** Thumbs: +1 or -2 on the episode, one feedback row, same transaction (caller wraps). */
export async function voteEpisode(query: AppQuery, v: { episodeId: number; runId: string; userId: number; vote: 1 | -1 }): Promise<void> {
  await query("INSERT INTO memory.episode_feedback (episode_id, run_id, user_id, vote) VALUES ($1, $2, $3, $4)", [v.episodeId, v.runId, v.userId, v.vote]);
  await query("UPDATE memory.episodes SET score = score + $2 WHERE id = $1", [v.episodeId, v.vote === 1 ? 1 : -2]);
}

/** Episode text is untrusted (another user wrote the question). Render it as data for the prompt. */
export function renderEpisodes(episodes: EpisodeRef[]): string {
  if (episodes.length === 0) return "";
  return episodes.map((e, i) => `<episode n="${i + 1}">\nquestion: ${e.question_templated.replace(/[<>]/g, "")}\nplan: ${JSON.stringify(e.plan)}\n</episode>`).join("\n");
}

function toRef(r: Record<string, unknown>): EpisodeRef {
  return { id: Number(r["id"]), question_templated: String(r["question_templated"]), plan: r["plan"] as Plan };
}
