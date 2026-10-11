/**
 * ToDo client picker — type-to-search contracts (presentation only; candidates come from the backend).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTodoClientPickerRows,
  filterTodoClientOptionsForDisplay,
  moveTodoClientPickerIndex,
  todoClientOptionMatchesText,
  todoOneTimeClientOptionLabel,
  TODO_CLIENT_PICKER_VISIBLE_LIMIT,
  type TodoClientPickerOption,
  TODO_CLIENT_PICKER_DEBOUNCE_MS,
} from '../src/lib/client-operations-todo-client-picker.pure.js';
import { moduleClientOperationsTodoClientOptions } from '../src/lib/client-operations-todo-url.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const opt = (id: string, name: string | null, tax: string | null = null): TodoClientPickerOption => ({
  client_id: id,
  display_name: name,
  tax_id: tax,
});

test('typing matches display name case-insensitively, any token order, and tax id', () => {
  const o = opt('c1', 'Alpha One Ltd', '510000001');
  assert.equal(todoClientOptionMatchesText(o, ''), true);
  assert.equal(todoClientOptionMatchesText(o, 'alp'), true);
  assert.equal(todoClientOptionMatchesText(o, 'ALPHA one'), true);
  assert.equal(todoClientOptionMatchesText(o, 'ltd alpha'), true);
  assert.equal(todoClientOptionMatchesText(o, '5100000'), true);
  assert.equal(todoClientOptionMatchesText(o, 'beta'), false);
  // Hebrew display names.
  const he = opt('c2', 'משה כהן בע"מ', '123456789');
  assert.equal(todoClientOptionMatchesText(he, 'כהן'), true);
  assert.equal(todoClientOptionMatchesText(he, 'משה בע'), true);
  assert.equal(todoClientOptionMatchesText(he, 'לוי'), false);
});

test('the DOM never holds more than the visible limit, however many options are passed in', () => {
  const many = Array.from({ length: 5000 }, (_, i) => opt(`c${i}`, `Client ${i}`));
  assert.equal(filterTodoClientOptionsForDisplay(many, '').length, TODO_CLIENT_PICKER_VISIBLE_LIMIT);
  assert.equal(filterTodoClientOptionsForDisplay(many, 'client 4').length, TODO_CLIENT_PICKER_VISIBLE_LIMIT);
  assert.deepEqual(
    filterTodoClientOptionsForDisplay(many, 'client 4999').map((o) => o.client_id),
    ['c4999'],
  );
});

test('the picker never invents a client: output is always a subset of the backend options', () => {
  const backend = [opt('a', 'Alpha'), opt('b', 'Beta')];
  const shown = filterTodoClientOptionsForDisplay(backend, 'a');
  for (const s of shown) assert.ok(backend.includes(s));
  assert.deepEqual(filterTodoClientOptionsForDisplay(backend, 'zzz'), []);
});

test('keyboard navigation wraps and handles empty lists', () => {
  assert.equal(moveTodoClientPickerIndex(-1, 1, 3), 0);
  assert.equal(moveTodoClientPickerIndex(-1, -1, 3), 2);
  assert.equal(moveTodoClientPickerIndex(2, 1, 3), 0);
  assert.equal(moveTodoClientPickerIndex(0, -1, 3), 2);
  assert.equal(moveTodoClientPickerIndex(0, 1, 0), -1);
});

test('picker component: accessible combobox, label לקוח, RTL-safe, no network / ACL logic of its own', () => {
  const picker = read('../src/components/client-operations/ClientOperationsTodoClientPicker.tsx');
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /<label htmlFor=\{inputId\}>לקוח<\/label>/);
  assert.match(picker, /aria-activedescendant/);
  assert.match(picker, /ArrowDown/);
  assert.match(picker, /e\.key === 'Enter'/);
  assert.match(picker, /e\.key === 'Escape'/);
  // Presentation only: no fetches, no endpoints, no ACL / workspace reasoning.
  const code = picker.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /apiJson|fetch\(|endpoints|workspace|acl|authorized_client_ids/i);
  // Bounded DOM.
  assert.match(picker, /buildTodoClientPickerRows\(options, text, \{[\s\S]*?limit: TODO_CLIENT_PICKER_VISIBLE_LIMIT/);
});

test('ToDo form uses the picker, stores the canonical client_id, creates no clients and no free text', () => {
  const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
  assert.match(modal, /<ClientOperationsTodoClientPicker/);
  assert.doesNotMatch(modal, /<span>לקוח<\/span>\s*<input\s+type="search"/);
  // Selection stores the backend id; label is display only.
  assert.match(modal, /setClientId\(o\.client_id\)/);
  assert.match(modal, /client_id: clientId/);
  // The only client read is the workspace-scoped, backend-authorized `todo/client-options` endpoint.
  assert.equal((modal.match(/moduleClientOperationsTodoClientOptions\(/g) ?? []).length, 1);
  assert.match(modal, /\.\.\.workspaceQuery/);
  // Search is debounced (no per-keystroke request) and a stale response can never overwrite a newer one.
  assert.match(modal, /TODO_CLIENT_PICKER_DEBOUNCE_MS/);
  assert.match(modal, /if \(cancelled\) return;/);
  // No client creation from ToDo.
  assert.doesNotMatch(modal, /create_client\b(?!_operations_todo)|moduleClientsCreate|new_client|free_text_client/i);
});

test('client-options URL carries the workspace and the typed text; the limit stays small', () => {
  const url = moduleClientOperationsTodoClientOptions({
    q: ' alpha ',
    limit: TODO_CLIENT_PICKER_VISIBLE_LIMIT,
    workspace_scope: 'staff',
    workspace_subject_user_id: 'u-1',
  });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.get('q'), 'alpha');
  assert.equal(qs.get('limit'), String(TODO_CLIENT_PICKER_VISIBLE_LIMIT));
  assert.equal(qs.get('workspace_scope'), 'staff');
  assert.equal(qs.get('workspace_subject_user_id'), 'u-1');
  assert.ok(TODO_CLIENT_PICKER_VISIBLE_LIMIT <= 50);
});

test('ToDo picker keeps the Arial surface and RTL list styling', () => {
  const css = read('../src/styles/nx-client-operations-todo.css');
  assert.match(css, /\.nx-co-todo-form__suggest/);
  assert.match(css, /inset-inline: 0/);
  assert.match(css, /\.nx-co-todo-form__suggest li\.is-active button/);
});

// ── one-time / external client (migration 188) ───────────────────────────────────────────────────────

test('picker rows: backend matches first (bounded), then the typed-name one-time option', () => {
  const many = Array.from({ length: 500 }, (_, i) => opt(`c${i}`, `Client ${i}`));
  const rows = buildTodoClientPickerRows(many, 'client', { allowOneTime: true });
  assert.equal(rows.length, TODO_CLIENT_PICKER_VISIBLE_LIMIT + 1);
  assert.ok(rows.slice(0, -1).every((r) => r.kind === 'client'));
  assert.deepEqual(rows[rows.length - 1], { kind: 'one_time', name: 'client' });
  // No match → the typed name is the only row (Enter picks it).
  assert.deepEqual(buildTodoClientPickerRows(many, '  יוסי כהן - חד פעמי ', { allowOneTime: true }), [
    { kind: 'one_time', name: 'יוסי כהן - חד פעמי' },
  ]);
  // Nothing typed, or backend says one-time clients are not allowed → no one-time row.
  assert.ok(buildTodoClientPickerRows(many, '', { allowOneTime: true }).every((r) => r.kind === 'client'));
  assert.ok(buildTodoClientPickerRows(many, 'client', { allowOneTime: false }).every((r) => r.kind === 'client'));
  assert.deepEqual(buildTodoClientPickerRows([], '   ', { allowOneTime: true }), []);
  assert.equal(todoOneTimeClientOptionLabel('יוסי'), 'השתמש בשם שהוקלד: "יוסי"');
});

test('picker component: canonical selection vs one-time selection, keyboard-reachable, clear mode badge', () => {
  const picker = read('../src/components/client-operations/ClientOperationsTodoClientPicker.tsx');
  assert.match(picker, /if \(row\.kind === 'client'\) onSelect\(row\.option\);\s*else onSelectOneTime\(row\.name\)/);
  assert.match(picker, /todoOneTimeClientOptionLabel\(row\.name\)/);
  assert.match(picker, /data-option-kind=\{row\.kind\}/);
  assert.match(picker, /data-client-mode=/);
  assert.match(picker, /לקוח חד פעמי/);
  // The one-time row takes part in arrow-key navigation / Enter like every other row.
  assert.match(picker, /moveTodoClientPickerIndex\(cur, e\.key === 'ArrowDown' \? 1 : -1, rows\.length\)/);
  assert.match(picker, /choose\(rows\[activeIndex\]\)/);
  // The 150 ms debounce / backend search of d444c2d1 is untouched in the form.
  const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
  assert.match(modal, /TODO_CLIENT_PICKER_DEBOUNCE_MS/);
  assert.equal((modal.match(/moduleClientOperationsTodoClientOptions\(/g) ?? []).length, 1);
  assert.equal(TODO_CLIENT_PICKER_DEBOUNCE_MS, 150);
});

test('ToDo form: canonical → client_id only; typed name → external_client_name; no fake client_id; no client creation', () => {
  const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
  // Create payload: either client_id OR the one-time fields — never both, never a made-up id.
  assert.match(modal, /\.\.\.\(clientId\s*\?\s*\{ client_id: clientId \}\s*:\s*\{ external_client_name: typedName, external_client_tax_id: taxId\.trim\(\) \|\| null \}\)/);
  assert.match(modal, /const typedName = oneTimeName \|\| clientQ\.trim\(\);/);
  assert.doesNotMatch(modal, /client_id:\s*(typedName|oneTimeName|clientQ|crypto|uuid)/);
  // Valid one-time text never triggers the "choose a client" error.
  assert.match(modal, /if \(!clientId && !typedName\) throw new Error\('נא לבחור לקוח או להקליד שם לקוח'\)/);
  assert.doesNotMatch(modal, /throw new Error\('נא לבחור לקוח'\)/);
  // Selecting the one-time row clears any canonical id and creates nothing.
  assert.match(modal, /onSelectOneTime=\{\(name\) => \{[\s\S]*?setClientId\(''\);[\s\S]*?setOneTimeName\(name\);/);
  assert.doesNotMatch(modal, /moduleClientsCreate|create_client\b(?!_operations_todo)|new_client|client_operational_profile/i);
  // Canonical selection keeps read-only Core tax id; one-time tax id is optional + editable.
  assert.match(modal, /readOnly=\{mode === 'create' \? Boolean\(clientId\) : !editingOneTime\}/);
  assert.match(modal, /placeholder=\{[^}]*'אופציונלי'/);
  assert.doesNotMatch(modal, /<input[^>]*taxId[^>]*required/);
});

test('ToDo edit: one-time fields go through the existing named edit command; type comes from the backend', () => {
  const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
  assert.match(modal, /const editingOneTime = mode === 'edit' && task\?\.client\.is_one_time === true;/);
  assert.match(modal, /command: 'update_client_operations_todo'/);
  assert.match(modal, /\.\.\.\(editingOneTime\s*\?\s*\{ external_client_name: oneTimeName, external_client_tax_id: taxId\.trim\(\) \|\| null \}\s*:\s*\{\}\)/);
  // No PATCH / generic save, no client reassignment payload on edit.
  assert.doesNotMatch(modal, /method: 'PATCH'/);
  // Backend-owned flags: one-time capability + presentation (is_one_time / id null) are rendered, not derived.
  assert.match(modal, /oneTimeClient=\{board\?\.available_clients_hint\?\.one_time_client \?\? null\}/);
  assert.match(modal, /client: \{ id: string \| null; display_name: string \| null; tax_id: string \| null; is_one_time: boolean \}/);
});

test('card and archive show the one-time client with a clear tag; מטפל stays removed', () => {
  const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
  assert.equal((modal.match(/task\.client\.is_one_time|t\.client\.is_one_time/g) ?? []).length, 2);
  assert.equal((modal.match(/nx-co-todo-one-time-tag/g) ?? []).length, 2);
  assert.doesNotMatch(modal, /assigned_to_user_id|assigneeId|setAssignee|filter_assignee|showAssignee/);
  const css = read('../src/styles/nx-client-operations-todo.css');
  assert.match(css, /\.nx-co-todo-one-time-tag/);
  assert.match(css, /\.nx-co-todo-client-picker__mode/);
});