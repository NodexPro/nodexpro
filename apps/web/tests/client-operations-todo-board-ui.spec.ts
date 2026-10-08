/**
 * Stage 5B — Client Operations ToDo board UI contracts (source + pure).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodeTodoPriorityForSubmit,
  groupTodosByPriorityLane,
  TODO_BOARD_DESKTOP_CARDS_PER_ROW,
  TODO_PRIORITY_LANES,
  todoPriorityToLaneId,
} from '../src/lib/client-operations-todo-board.pure.js';
import {
  moduleClientOperationsTodoArchive,
  moduleClientOperationsTodoBoard,
  moduleClientOperationsTodoClientOptions,
  moduleClientOperationsTodoCommands,
} from '../src/lib/client-operations-todo-url.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
const view = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
const css = read('../src/styles/nx-client-operations-todo.css');
const panel = read('../src/components/ClientWorkspacePanel.tsx');
const endpoints = read('../src/api/endpoints.ts');
const todoSvc = read('../../api/src/domains/client-operations/client-operations-todo.service.ts');
const routes = read('../../api/src/domains/client-operations/client-operations.routes.ts');

test('A — ToDo List button opens board modal', () => {
  assert.match(view, /client-operations-todo-list-button/);
  assert.match(view, /setTodoBoardOpen\(true\)/);
  assert.match(view, /ClientOperationsTodoBoardModal/);
  assert.match(modal, /client-operations-todo-board/);
});

test('C/D — workspace query sent; no employee selector invented in ToDo', () => {
  assert.match(view, /workspaceQuery=\{\{/);
  assert.match(view, /workspace_scope: query\?\.workspace_scope/);
  assert.doesNotMatch(modal, /allowed_scopes\.map/);
  assert.doesNotMatch(modal, /available_workspace_subjects/);
});

test('E/F — lanes 1/2/3/4/null; no priority 5', () => {
  assert.equal(TODO_PRIORITY_LANES.length, 5);
  assert.equal(TODO_PRIORITY_LANES[4]?.priority, null);
  assert.equal(todoPriorityToLaneId(5 as never), 'none');
  assert.equal(encodeTodoPriorityForSubmit('5'), null);
  assert.equal(encodeTodoPriorityForSubmit('none'), null);
  const grouped = groupTodosByPriorityLane([
    { priority: 1 },
    { priority: null },
    { priority: 1 },
  ]);
  assert.equal(grouped.p1.length, 2);
  assert.equal(grouped.none.length, 1);
  assert.match(modal, /TODO_PRIORITY_LANES\.map/);
  assert.doesNotMatch(modal, /priority:\s*5|value="5"/);
});

test('G/H/I/J — card fields, double-click edit, Done command, no hidden GET after Done', () => {
  assert.match(modal, /nx-co-todo-sticky__client/);
  assert.match(modal, /nx-co-todo-sticky__tax/);
  assert.match(modal, /nx-co-todo-sticky__text/);
  assert.match(modal, /onDoubleClick/);
  assert.match(modal, /complete_client_operations_todo/);
  assert.match(modal, /applyBoardAggregate\(data\)/);
  // Done path uses command return — no board GET inside onComplete.
  const onCompleteSlice = modal.slice(
    modal.indexOf('const onComplete = async'),
    modal.indexOf('const onReopen = async'),
  );
  assert.doesNotMatch(onCompleteSlice, /moduleClientOperationsTodoBoard\(/);
});

test('K/L/N/O/P — create uses scoped options; no due/reminder/delete', () => {
  assert.match(modal, /moduleClientOperationsTodoClientOptions/);
  assert.match(modal, /moduleClientOperationsTodoAssigneeOptions/);
  assert.doesNotMatch(modal, /due_date|reminder|hard.?delete|DELETE/i);
  assert.match(modal, /isOffice/);
  assert.match(modal, /נא לבחור מטפל/);
});

test('Q/R/S/T — archive above board; reopen returns board+archive; no corrective GET', () => {
  assert.match(modal, /client-operations-todo-archive/);
  assert.match(modal, /setArchiveOpen\(false\)/);
  assert.match(modal, /reopen_client_operations_todo/);
  assert.match(modal, /moduleClientOperationsTodoArchive/);
  assert.match(modal, /archivePage/);
  assert.match(todoSvc, /ClientOperationsTodoReopenResult/);
  assert.match(todoSvc, /return \{ board, archive \}/);
  assert.match(modal, /data\.board && data\.archive/);
  assert.doesNotMatch(modal, /boardNeedsRefresh|setBoardNeedsRefresh/);
  const onReopenSlice = modal.slice(
    modal.indexOf('const onReopen = async'),
    modal.indexOf('const closeArchive'),
  );
  assert.doesNotMatch(onReopenSlice, /moduleClientOperationsTodoBoard\(/);
  const closeArchiveSlice = modal.slice(
    modal.indexOf('const closeArchive'),
    modal.indexOf('const onBoardKeyDown'),
  );
  assert.doesNotMatch(closeArchiveSlice, /loadBoard\(/);
  assert.match(todoSvc, /q\?: string \| null/);
  assert.match(routes, /q: typeof req\.query\.q === 'string'/);
});

test('U — nested Escape closes top modal only', () => {
  assert.match(modal, /if \(createOpen\)/);
  assert.match(modal, /if \(editTask\)/);
  assert.match(modal, /if \(archiveOpen\)/);
  assert.match(modal, /onClose\(\)/);
});

test('V/W — stale response protection via seq/abort', () => {
  assert.match(modal, /boardSeqRef/);
  assert.match(modal, /boardAbortRef/);
  assert.match(modal, /seq !== boardSeqRef\.current/);
  assert.match(modal, /archiveSeqRef/);
});

test('X/Y/Z — page size not row quota; no drag/drop', () => {
  assert.match(css, /flex-wrap/);
  assert.doesNotMatch(modal, /onDrag|draggable|dnd/i);
  assert.doesNotMatch(css, /onDrag|draggable/);
});

test('AA/AB/AC — no Work Engine / unrestricted clients / role auth', () => {
  assert.doesNotMatch(modal, /work-engine|work_engine|WorkEngine/i);
  assert.doesNotMatch(modal, /\/clients\?|moduleClients\(/);
  assert.doesNotMatch(modal, /role_code\s*===|roleCode\s*===|role ===/);
  assert.match(modal, /allowed_actions/);
});

test('AD — Arial on all ToDo portal layers', () => {
  assert.match(css, /font-family:\s*Arial,\s*sans-serif/);
  assert.match(css, /\.nx-co-todo-overlay/);
  assert.match(css, /\.nx-co-todo-archive-overlay/);
  assert.match(css, /\.nx-co-todo-form-overlay/);
});

test('AE — client handler ToDo conflict Hebrew UX', () => {
  assert.match(panel, /CLIENT_HANDLER_TODO_CONFLICT/);
  assert.match(panel, /משימות ToDo פעילות/);
});

test('URLs outside endpoints.ts; commands path', () => {
  assert.doesNotMatch(endpoints, /todo\/board|todo\/commands/);
  assert.equal(moduleClientOperationsTodoCommands(), '/m/client-operations/todo/commands');
  assert.match(moduleClientOperationsTodoBoard({ page: 2, q: 'א' }), /page=2/);
  assert.match(moduleClientOperationsTodoClientOptions({ q: 'x' }), /client-options/);
  assert.match(moduleClientOperationsTodoArchive({ page: 1 }), /todo\/archive/);
});

test('Board sticky yellow + priority lane accents', () => {
  assert.match(css, /#ffe566|#fff7a8/);
  assert.match(css, /nx-co-todo-lane--red/);
  assert.match(css, /nx-co-todo-lane--orange/);
  assert.match(css, /nx-co-todo-lane--gold/);
  assert.match(css, /nx-co-todo-lane--green/);
  assert.match(css, /nx-co-todo-lane--blue/);
});

test('visual board — five compact rows, fixed cards, null is visual 5', () => {
  assert.equal(TODO_PRIORITY_LANES.length, 5);
  assert.equal(TODO_BOARD_DESKTOP_CARDS_PER_ROW, 5);
  assert.deepEqual(
    TODO_PRIORITY_LANES.map((lane) => `${lane.visual_number} ${lane.label_he}`),
    ['1 דחוף', '2 גבוה', '3 בינוני', '4 נמוך', '5 ללא עדיפות'],
  );
  assert.deepEqual(
    TODO_PRIORITY_LANES.map((lane) => lane.accent),
    ['red', 'orange', 'gold', 'green', 'blue'],
  );
  assert.equal(TODO_PRIORITY_LANES[4]?.priority, null);
  assert.equal(encodeTodoPriorityForSubmit('none'), null);
  assert.match(modal, /nx-co-todo-lane__rail/);
  assert.match(modal, /nx-co-todo-priority/);
  assert.match(modal, /created_at/);
  assert.match(css, /flex:\s*0\s+0\s+168px/);
  assert.match(css, /flex-wrap:\s*nowrap/);
  assert.match(css, /5 priority rows × 5 fixed cards = 25/);
  assert.doesNotMatch(modal, /value="5"/);
  assert.doesNotMatch(modal, /priority:\s*5/);
  assert.match(modal, /complete_client_operations_todo/);
  assert.match(modal, /reopen_client_operations_todo/);
  assert.match(modal, /onDoubleClick/);
});
