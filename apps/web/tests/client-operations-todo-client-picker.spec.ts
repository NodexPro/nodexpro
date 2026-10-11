/**
 * ToDo client picker — type-to-search contracts (presentation only; candidates come from the backend).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filterTodoClientOptionsForDisplay,
  moveTodoClientPickerIndex,
  todoClientOptionMatchesText,
  TODO_CLIENT_PICKER_VISIBLE_LIMIT,
  type TodoClientPickerOption,
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
  assert.match(picker, /filterTodoClientOptionsForDisplay\(options, text, TODO_CLIENT_PICKER_VISIBLE_LIMIT\)/);
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
