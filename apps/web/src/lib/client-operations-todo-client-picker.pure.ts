/**
 * ToDo client picker — PRESENTATION-ONLY helpers.
 *
 * The authorized candidate set always comes from the backend (`todo/client-options`, scoped to the
 * selected workspace + client ACL). These helpers only narrow / navigate options the backend already
 * returned, so typing feels instant while the (debounced) scoped search is in flight. They never decide
 * which clients a user may see and never produce a client the backend did not send.
 */

export type TodoClientPickerOption = {
  client_id: string;
  display_name: string | null;
  tax_id: string | null;
};

/** Visible rows in the dropdown — the DOM never holds more than this. */
export const TODO_CLIENT_PICKER_VISIBLE_LIMIT = 20;
export const TODO_CLIENT_PICKER_DEBOUNCE_MS = 150;

export function todoClientPickerTokens(raw: string): string[] {
  return String(raw ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Case-insensitive; every typed token must appear in the client display name or tax id. */
export function todoClientOptionMatchesText(option: TodoClientPickerOption, text: string): boolean {
  const tokens = todoClientPickerTokens(text);
  if (tokens.length === 0) return true;
  const haystack = `${option.display_name ?? ''} ${option.tax_id ?? ''}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

export function filterTodoClientOptionsForDisplay(
  options: readonly TodoClientPickerOption[],
  text: string,
  limit: number = TODO_CLIENT_PICKER_VISIBLE_LIMIT,
): TodoClientPickerOption[] {
  const out: TodoClientPickerOption[] = [];
  for (const option of options) {
    if (!todoClientOptionMatchesText(option, text)) continue;
    out.push(option);
    if (out.length >= limit) break;
  }
  return out;
}

/** Arrow-key navigation with wrap-around; -1 = nothing active. */
export function moveTodoClientPickerIndex(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}

/**
 * One-time client row: the typed text kept as the client name of the ToDo itself.
 * Choosing it never creates a Core client — the backend stores it on the ToDo (migration 188) and validates it.
 */
export type TodoClientPickerRow =
  | { kind: 'client'; option: TodoClientPickerOption }
  | { kind: 'one_time'; name: string };

export function todoOneTimeClientOptionLabel(name: string): string {
  return `השתמש בשם שהוקלד: "${name}"`;
}

/** Trim only — the backend decides whether the name is valid. */
export function todoTypedClientName(text: string): string {
  return String(text ?? '').trim();
}

/** Backend-authorized matches (bounded) followed by the one-time option when text was typed. */
export function buildTodoClientPickerRows(
  options: readonly TodoClientPickerOption[],
  text: string,
  params: { allowOneTime: boolean; limit?: number },
): TodoClientPickerRow[] {
  const rows: TodoClientPickerRow[] = filterTodoClientOptionsForDisplay(
    options,
    text,
    params.limit ?? TODO_CLIENT_PICKER_VISIBLE_LIMIT,
  ).map((option) => ({ kind: 'client' as const, option }));
  const typed = todoTypedClientName(text);
  if (params.allowOneTime && typed) rows.push({ kind: 'one_time', name: typed });
  return rows;
}
