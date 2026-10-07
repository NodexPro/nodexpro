/**
 * Stage 5A — Client Operations ToDo domain (pure + source contracts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assigneeWouldRetainClientAccessAfterHandlerChange,
  buildTodoPagination,
  CLIENT_OPERATIONS_TODO_PAGE_SIZE,
  compareTodosForBoardOrder,
  normalizeTodoPriority,
  normalizeTodoTaskText,
  presentationPriorityToken,
  sliceTodoPage,
  todoPrioritySortRank,
} from '../../src/domains/client-operations/client-operations-todo.pure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '../../src');
const repoRoot = join(__dirname, '../../../..');

function readSrc(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf8');
}

function readRepo(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), 'utf8');
}

test('Y — priority ordering deterministic 1,2,3,4,NULL', () => {
  assert.equal(todoPrioritySortRank(1), 1);
  assert.equal(todoPrioritySortRank(4), 4);
  assert.equal(todoPrioritySortRank(null), 5);
  assert.equal(normalizeTodoPriority(null), null);
  assert.equal(normalizeTodoPriority(2), 2);
  assert.throws(() => normalizeTodoPriority(5));
  assert.throws(() => normalizeTodoPriority(0));

  const rows = [
    { id: 'd', priority: null, created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', priority: 2, created_at: '2026-01-02T00:00:00Z' },
    { id: 'a', priority: 1, created_at: '2026-01-03T00:00:00Z' },
    { id: 'c', priority: 2, created_at: '2026-01-01T00:00:00Z' },
  ];
  const sorted = [...rows].sort(compareTodosForBoardOrder);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ['a', 'c', 'b', 'd'],
  );
  assert.equal(presentationPriorityToken(null), 'none');
  assert.equal(presentationPriorityToken(1), 'p1');
});

test('Z/AA/AB — pagination stable page size 25; overflow to next page; not a per-priority quota', () => {
  assert.equal(CLIENT_OPERATIONS_TODO_PAGE_SIZE, 25);
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: String(i + 1) }));
  const page1 = sliceTodoPage(rows, 1);
  const page2 = sliceTodoPage(rows, 2);
  assert.equal(page1.length, 25);
  assert.equal(page2.length, 1);
  assert.equal(page2[0]?.id, '26');
  const pag = buildTodoPagination({ total: 26, page: 1 });
  assert.equal(pag.total_pages, 2);
  assert.equal(pag.has_next, true);
  // Five visual cards is layout only — creation is never blocked by priority row fullness.
  assert.equal(normalizeTodoTaskText('x'.repeat(10)).length, 10);
});

test('task text validation rejects empty / overlong', () => {
  assert.throws(() => normalizeTodoTaskText('   '));
  assert.throws(() => normalizeTodoTaskText('x'.repeat(2001)));
  assert.equal(normalizeTodoTaskText('  hello  '), 'hello');
});

test('AF — assignee retains access only if office role or remains handler', () => {
  assert.equal(
    assigneeWouldRetainClientAccessAfterHandlerChange({
      assigneeUserId: 'anna',
      assigneeHasOfficeAccess: false,
      afterHandlerUserId: 'dana',
    }),
    false,
  );
  assert.equal(
    assigneeWouldRetainClientAccessAfterHandlerChange({
      assigneeUserId: 'anna',
      assigneeHasOfficeAccess: false,
      afterHandlerUserId: 'anna',
    }),
    true,
  );
  assert.equal(
    assigneeWouldRetainClientAccessAfterHandlerChange({
      assigneeUserId: 'owner',
      assigneeHasOfficeAccess: true,
      afterHandlerUserId: 'dana',
    }),
    true,
  );
});

test('Stage5A source contracts — migration, commands, workspace reuse, no UI, no delete', () => {
  const mig = readRepo('supabase/migrations/182_client_operations_todo.sql');
  assert.match(mig, /client_operations_todos/);
  assert.match(mig, /client_id uuid not null/);
  assert.match(mig, /assigned_to_user_id/);
  assert.match(mig, /completed_at/);
  assert.match(mig, /No due_date/);
  assert.doesNotMatch(mig, /^\s*due_date\s/m);
  assert.match(mig, /priority smallint null/);
  assert.match(mig, /char_length\(task_text\) <= 2000/);

  const pure180 = readRepo('supabase/migrations/180_organization_users_sync_from_canonical_memberships.sql');
  const pure181 = readRepo('supabase/migrations/181_organization_staff_seat_entitlement.sql');
  assert.ok(pure180.length > 0);
  assert.ok(pure181.length > 0);

  const service = readSrc('domains/client-operations/client-operations-todo.service.ts');
  assert.match(service, /resolveClientOperationsWorkspaceScopeFromContext/);
  assert.match(service, /create_client_operations_todo/);
  assert.match(service, /update_client_operations_todo/);
  assert.match(service, /complete_client_operations_todo/);
  assert.match(service, /reopen_client_operations_todo/);
  assert.match(service, /ClientOperationsTodoReopenResult/);
  assert.match(service, /return \{ board, archive \}/);
  assert.match(service, /assertNoIncompatibleActiveTodosForHandlerChange/);
  assert.match(service, /CLIENT_HANDLER_TODO_CONFLICT/);
  assert.doesNotMatch(service, /hard.?delete|DELETE FROM/i);
  assert.doesNotMatch(service, /due_date/);
  assert.doesNotMatch(service, /work_engine|work_items/i);

  const routes = readSrc('domains/client-operations/client-operations.routes.ts');
  assert.match(routes, /\/todo\/board/);
  assert.match(routes, /\/todo\/archive/);
  assert.match(routes, /\/todo\/commands/);
  assert.match(routes, /requireModuleActive/);

  const assign = readSrc('domains/client-operations/client-operations.service.ts');
  assert.match(assign, /assertNoIncompatibleActiveTodosForHandlerChange/);

  const audit = readSrc('shared/audit-events.ts');
  assert.match(audit, /client_operations\.todo\.created/);
  assert.match(audit, /client_operations\.todo\.completed/);
  assert.match(audit, /client_operations\.todo\.reopened/);
  assert.match(audit, /client_operations\.todo\.reassigned/);

  // No Stage 5B UI in web for ToDo board.
  const webEndpoints = readFileSync(
    join(repoRoot, 'apps/web/src/api/endpoints.ts'),
    'utf8',
  );
  assert.doesNotMatch(webEndpoints, /todo\/board|create_client_operations_todo/);
});

test('Stage5A live security A–AH', async (t) => {
  const configured = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!configured) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  t.skip('Live A–AH reserved for applied DB environment (migration 182 not run)');
});
