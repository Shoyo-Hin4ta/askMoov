/** Names for id columns, as /api/runs/[id] serves them: { column: { id: label } }. The server decides which columns carry ids. */
export type Labels = Record<string, Record<string, string>>;

const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === "";

/** The label for an id, or undefined when the column or the id is not in the map. Ids are keyed as strings. */
export function labelFor(labels: Labels, column: string, value: unknown): string | undefined {
  if (isEmpty(value)) return undefined;
  return labels[column]?.[String(value)];
}

/** The label when known, otherwise the id as text. */
export function displayId(labels: Labels, column: string, value: unknown): string {
  return labelFor(labels, column, value) ?? (isEmpty(value) ? "" : String(value));
}

/** "Name (id)" when the label is known, so the id stays traceable in tooltips and titles. */
export function labelWithId(labels: Labels, column: string, value: unknown): string {
  const label = labelFor(labels, column, value);
  return label ? `${label} (${String(value)})` : displayId(labels, column, value);
}
