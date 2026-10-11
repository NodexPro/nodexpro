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
