/** A run id is a uuid. Checked before any query: a non-uuid against a uuid column is a database error, not a 404. */
export const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRunId = (s: string): boolean => RUN_ID.test(s);
