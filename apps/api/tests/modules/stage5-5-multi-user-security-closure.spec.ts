/**
 * Stage 5.5 — multi-user security closure.
 * Pure rules and source contracts. No live Supabase env.
 *
 * Numbering follows the Stage 5.5 test plan:
 *   1–8 documents, 9–13 DocFlow, 14–17 counts, 18–20 modules,
 *   21–24 access removal, 25–28 direct ids, 29–33 regression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  documentClientAccessible,
  evaluateDocumentClientChange,
  restrictDocumentLinks,
} from '../../src/domains/documents/document-client-access.pure.js';
import {
  buildAuthorizedInboxPage,
  buildAuthorizedTaskCenterPage,
  chunkIds,
  computeAuthorizedTaskCenterThreadKpis,
  paginateAuthorizedRows,
  threadPassesTaskCenterFilters,
  type AuthorizedInboxClient,
  type AuthorizedTaskThread,
} from '../../src/domains/docflow/docflow-authorized-paging.pure.js';
import {
  collectIncomeRequestIds,
  incomeRequestHasResourceIds,
} from '../../src/domains/income/income-request-resource-ids.pure.js';
import {
  clientScopeOrFilter,
  rowClientAllowed,
} from '../../src/domains/work-engine/work-engine-client-scope.pure.js';
import {
  classifyModule,
  deriveEffectiveMemberModuleIds,
  findNonAssignableModuleIds,
  projectModuleAssignability,
  type ModuleCatalogRow,
} from '../../src/domains/modules/member-module-assignability.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readRepo = (rel: string): string => readFileSync(join(root, rel), 'utf8');

const api = (rel: string): string => readRepo(`apps/api/src/${rel}`);

// ── Documents (1–8) ─────────────────────────────────────────────────────────

test('1. client-owned document: authorized client opens it, unauthorized client does not', () => {
  assert.equal(documentClientAccessible(['A'], 'A'), true);
  assert.equal(documentClientAccessible(['A'], 'B'), false);
});

test('2. clientless document keeps existing semantics for restricted callers', () => {
  assert.equal(documentClientAccessible(['A'], null), true);
  assert.equal(documentClientAccessible([], undefined), true);
});

test('3. Owner/Admin and ALL-access (null allow-list) are unchanged', () => {
  assert.equal(documentClientAccessible(null, 'Z'), true);
  assert.deepEqual(evaluateDocumentClientChange({ allowedClientIds: null, currentClientId: 'A', nextClientId: null }), {
    ok: true,
  });
  assert.equal(restrictDocumentLinks([{ target_entity_type: 'client', target_entity_id: 'Q' }], null).length, 1);
});

test('4. re-association A→B needs BOTH clients; unauthorized source or target is refused', () => {
  const ok = evaluateDocumentClientChange({ allowedClientIds: ['A', 'B'], currentClientId: 'A', nextClientId: 'B' });
  assert.equal(ok.ok, true);
  const noTarget = evaluateDocumentClientChange({ allowedClientIds: ['A'], currentClientId: 'A', nextClientId: 'B' });
  assert.deepEqual(noTarget, { ok: false, reason: 'target_client_unauthorized' });
  const noSource = evaluateDocumentClientChange({ allowedClientIds: ['B'], currentClientId: 'A', nextClientId: 'B' });
  assert.deepEqual(noSource, { ok: false, reason: 'source_client_unauthorized' });
});

test('5. restricted caller cannot detach a client-owned document into an org-level one', () => {
  assert.deepEqual(
    evaluateDocumentClientChange({ allowedClientIds: ['A'], currentClientId: 'A', nextClientId: null }),
    { ok: false, reason: 'detach_not_allowed' },
  );
  // a clientless document stays clientless without error
  assert.equal(
    evaluateDocumentClientChange({ allowedClientIds: ['A'], currentClientId: null, nextClientId: null }).ok,
    true,
  );
});

test('6. links to unauthorized clients are not exposed', () => {
  const links = [
    { id: '1', target_entity_type: 'client', target_entity_id: 'A' },
    { id: '2', target_entity_type: 'client', target_entity_id: 'B' },
    { id: '3', target_entity_type: 'invoice', target_entity_id: 'X' },
  ];
  assert.deepEqual(
    restrictDocumentLinks(links, ['A']).map((l) => l.id),
    ['1', '3'],
  );
  assert.deepEqual(restrictDocumentLinks(links, []).map((l) => l.id), ['3']);
});

test('7. every document route resolving a document id uses the shared document guard', () => {
  const documents = api('domains/documents/documents.service.ts');
  const links = api('domains/documents/document-links.service.ts');
  const card = api('domains/documents/document-card.service.ts');
  const upload = api('domains/documents/document-upload.service.ts');
  const versions = api('domains/documents/document-versions.service.ts');
  for (const [name, src] of Object.entries({ documents, links, card, upload, versions })) {
    assert.match(src, /assertDocumentClientAccess/, `${name} must call assertDocumentClientAccess`);
  }
  assert.match(documents, /assertDocumentClientChange/);
  assert.match(links, /assertDocumentClientChange/);
  assert.match(links, /restrictDocumentLinks/);
  assert.match(card, /restrictDocumentLinks/);
});

test('8. document guard answers with not-found semantics', () => {
  const guard = api('domains/documents/document-client-access.ts');
  assert.match(guard, /forbidden\('Document not found'\)/);
  assert.match(guard, /authorizedClientIdsForViewer/);
});

// ── DocFlow (9–13) ──────────────────────────────────────────────────────────

const clients = (n: number): AuthorizedInboxClient[] =>
  Array.from({ length: n }, (_, i) => ({
    client_id: `c${i}`,
    display_name: `Client ${String(i).padStart(2, '0')}`,
    status: 'active',
    phone: null,
    email: null,
  }));

test('9. inbox: authorized rows are filtered BEFORE paging; total excludes unauthorized rows', () => {
  const all = clients(10);
  const allow = ['c1', 'c3', 'c5', 'c7', 'c9'];
  const page1 = buildAuthorizedInboxPage({ clients: all, activityByClient: new Map(), allowedClientIds: allow, page: 1, pageSize: 2 });
  assert.equal(page1.total, 5);
  assert.equal(page1.rows.length, 2);
  const page3 = buildAuthorizedInboxPage({ clients: all, activityByClient: new Map(), allowedClientIds: allow, page: 3, pageSize: 2 });
  assert.equal(page3.rows.length, 1);
  assert.ok(page3.rows.every((r) => allow.includes(r.client_id)));
});

test('10. interleaved unauthorized rows never create short or empty pages', () => {
  const all = clients(20);
  const allow = all.filter((_, i) => i % 5 === 0).map((c) => c.client_id); // 4 of 20
  const page = buildAuthorizedInboxPage({ clients: all, activityByClient: new Map(), allowedClientIds: allow, page: 1, pageSize: 4 });
  assert.equal(page.rows.length, 4);
  assert.equal(page.total, 4);
  const empty = buildAuthorizedInboxPage({ clients: all, activityByClient: new Map(), allowedClientIds: [], page: 1, pageSize: 4 });
  assert.equal(empty.total, 0);
  assert.equal(empty.rows.length, 0);
});

const thread = (id: string, client: string, over: Partial<AuthorizedTaskThread> = {}): AuthorizedTaskThread => ({
  thread_id: id,
  client_id: client,
  module_key: 'general',
  thread_type: 'task',
  thread_status: 'open',
  deadline_at: null,
  assigned_user_id: null,
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

test('11. task center: KPIs and pages are computed over authorized threads only', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const authorized = [
    thread('t1', 'A', { deadline_at: '2026-01-02T00:00:00Z' }),
    thread('t2', 'A', { thread_status: 'waiting_client', assigned_user_id: 'me' }),
  ];
  const kpis = computeAuthorizedTaskCenterThreadKpis(authorized, 'me', now);
  assert.deepEqual(kpis, { overdue_count: 1, waiting_client_count: 1, assigned_to_me_count: 1 });
  const rows = authorized
    .filter((t) => threadPassesTaskCenterFilters(t, 'Client A', null, null, {}, 'me', now))
    .map((t) => ({ ...t, client_name: 'Client A' }));
  const page = buildAuthorizedTaskCenterPage({ rows, page: 1, pageSize: 25 });
  assert.equal(page.total_rows, 2);
});

test('12. paging helpers clamp pages and size without leaking extra totals', () => {
  const r = paginateAuthorizedRows([1, 2, 3, 4, 5], 99, 2);
  assert.equal(r.effective_page, 3);
  assert.deepEqual(r.rows, [5]);
  assert.equal(r.total_rows, 5);
  assert.equal(paginateAuthorizedRows([], 1, 25).total_pages, 0);
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('13. DocFlow read models and commands apply the allow-list before paging, with not-found semantics', () => {
  const inbox = api('domains/docflow/docflow-read-models.service.ts');
  assert.match(inbox, /loadAuthorizedInboxClients/);
  assert.match(inbox, /buildAuthorizedInboxPage/);
  assert.doesNotMatch(inbox, /if \(inboxAllowList\) total = pageRows\.length/);
  const taskCenter = api('domains/docflow/docflow-task-center.service.ts');
  assert.match(taskCenter, /buildAuthorizedTaskCenterPage/);
  assert.match(taskCenter, /computeAuthorizedTaskCenterThreadKpis/);
  const widget = api('domains/docflow/docflow-floating-widget.service.ts');
  assert.match(widget, /loadAuthorizedWidgetDraftRows/);
  const commands = api('domains/docflow/docflow-commands.service.ts');
  assert.match(commands, /assertDocflowPayloadThreadsAuthorized/);
  assert.match(commands, /notFound\('Thread not found'\)/);
  const rule = api('domains/docflow/docflow-communication-rule.service.ts');
  assert.match(rule, /assertDraftClientAccess/);
  assert.match(rule, /notFound\('Draft not found'\)/);
});

// ── Counts (14–17) ──────────────────────────────────────────────────────────

test('14. Income self-mode counts are personal for restricted members', () => {
  const panel = api('domains/income/income-client-document-management-panel.service.ts');
  assert.match(panel, /countSelfModeRows\(/);
  assert.match(panel, /clientScope\.kind === 'OFFICE' \? null : params\.ctx\.user\.id/);
  assert.match(panel, /actor_user_id/);
});

test('15. Work Engine counts, catalog and recent rows are scoped by the 5.1 allow-list', () => {
  const read = api('domains/work-engine/work-engine.read-models.service.ts');
  assert.match(read, /workEngineAllowedClientIds/);
  assert.match(read, /scopeQueryToAllowedClients/);
  const catalog = api('domains/work-engine/work-engine-queue-summary-catalog.exact.ts');
  assert.match(catalog, /scopeQueryToAllowedClients/);
  const reminder = api('domains/work-engine/work-engine.reminder-review.service.ts');
  assert.match(reminder, /authorizedWorkItemIdSet/);
});

test('16. row scoping: clientless work items stay visible, unauthorized clients vanish, empty list = none', () => {
  assert.equal(rowClientAllowed(null, ['A']), true);
  assert.equal(rowClientAllowed('B', ['A']), false);
  assert.equal(rowClientAllowed('B', []), false);
  assert.equal(rowClientAllowed('B', null), true);
  assert.equal(clientScopeOrFilter([]), 'client_id.is.null');
  assert.equal(clientScopeOrFilter(['A', 'C']), 'client_id.is.null,client_id.in.(A,C)');
});

test('17. class C (office-administration) summaries are never served to restricted callers', () => {
  const read = api('domains/work-engine/work-engine.read-models.service.ts');
  assert.match(read, /clientRestricted[\s\S]{0,200}buildFailedOperationsSummary|buildFailedOperationsSummary[\s\S]{0,400}rows: \[\]/);
  const rule = api('domains/docflow/docflow-communication-rule.service.ts');
  assert.match(rule, /run_communication_rule[\s\S]{0,400}forbidden|forbidden[\s\S]{0,400}run_communication_rule/);
});

// ── Modules (18–20) ─────────────────────────────────────────────────────────

const catalog: ModuleCatalogRow[] = [
  { id: 'm-co', code: 'client-operations', is_active: true, is_system: false, nav_path: '/m/client-operations' },
  { id: 'm-inv', code: 'invoice', is_active: true, is_system: false, nav_path: '/m/income' },
  { id: 'm-doc', code: 'docflow', is_active: true, is_system: false, nav_path: null },
  { id: 'm-we', code: 'work_engine', is_active: true, is_system: true, nav_path: null },
  { id: 'm-off', code: 'retired', is_active: false, is_system: false, nav_path: '/m/retired' },
];

test('18. Work Engine is infrastructure: no checkbox, no sidebar item; business modules are assignable', () => {
  const kinds = Object.fromEntries(catalog.map((m) => [m.code, classifyModule(m)]));
  assert.equal(kinds.work_engine, 'infrastructure');
  assert.equal(kinds.invoice, 'user_facing');
  assert.equal(kinds['client-operations'], 'user_facing');
  assert.equal(kinds.docflow, 'user_facing');
  const we = projectModuleAssignability({ row: catalog[3]!, organizationEntitled: true, memberEnabled: true });
  assert.equal(we.member_assignable, false);
  assert.equal(we.navigation_available, false);
  const inv = projectModuleAssignability({ row: catalog[1]!, organizationEntitled: true, memberEnabled: true });
  assert.deepEqual(
    [inv.organization_entitled, inv.member_assignable, inv.member_enabled, inv.navigation_available],
    [true, true, true, true],
  );
  const unentitled = projectModuleAssignability({ row: catalog[1]!, organizationEntitled: false, memberEnabled: true });
  assert.deepEqual(
    [unentitled.member_assignable, unentitled.member_enabled, unentitled.navigation_available],
    [false, false, false],
  );
});

test('19. assignment of infrastructure, inactive or unknown modules is refused', () => {
  assert.deepEqual(findNonAssignableModuleIds(catalog, ['m-inv', 'm-doc']), []);
  assert.deepEqual(findNonAssignableModuleIds(catalog, ['m-we']), ['m-we']);
  assert.deepEqual(findNonAssignableModuleIds(catalog, ['m-off']), ['m-off']);
  assert.deepEqual(findNonAssignableModuleIds(catalog, ['nope']), ['nope']);
  const svc = api('domains/modules/member-module-access.service.ts');
  assert.match(svc, /findNonAssignableModuleIds\(await loadModuleCatalog\(\), moduleIds\)/);
  assert.match(svc, /MEMBER_MODULE_ACCESS_NOT_ASSIGNABLE/);
});

test('20. infrastructure follows a granted host module (Income / Client Operations) and never stands alone', () => {
  const grant = (...ids: string[]) => deriveEffectiveMemberModuleIds(catalog, new Set(ids));
  assert.ok(grant('m-inv').has('m-we'));
  assert.ok(grant('m-co').has('m-we'));
  assert.equal(grant('m-doc').has('m-we'), false);
  // a legacy (5.4 backfill) grant stored on Work Engine alone grants nothing
  assert.equal(grant('m-we').size, 0);
  // session, modules-state and the gate share the same function
  const svc = api('domains/modules/member-module-access.service.ts');
  assert.match(svc, /deriveEffectiveMemberModuleIds\(await loadModuleCatalog\(\), granted\)/);
  assert.match(api('domains/modules/modules-state.service.ts'), /loadEnabledMemberModuleIdSet/);
  assert.match(api('domains/auth/auth.routes.ts'), /loadEnabledMemberModuleIdSet/);
  assert.match(api('middleware/requireModuleActive.ts'), /assertStaffViewerMayUseModule/);
  assert.match(api('domains/memberships/memberships.routes.ts'), /module-assignability/);
});

// ── Access removal (21–24) ──────────────────────────────────────────────────

test('21. module removal denies the next request: gate reads the live grant, no module cache before it', () => {
  const gate = api('middleware/requireModuleActive.ts');
  assert.match(gate, /assertStaffViewerMayUseModule/);
  const svc = api('domains/modules/member-module-access.service.ts');
  assert.doesNotMatch(svc, /new Map\(\)\s*;\s*\/\/\s*cache/i);
  const cache = api('domains/client-operations/client-operations-registry-materialization-cache.ts');
  assert.match(cache, /requireModuleActive/);
});

test('22. client removal: persisted Income workspace client is re-authorized on every resolve', () => {
  const issuer = api('domains/income/income-issuer-context.service.ts');
  assert.match(issuer, /issuer_context_reset/);
  assert.match(issuer, /allowedClientIds/);
  assert.match(issuer, /assertCanAccessClientFromContext/);
});

test('23. the 5.1 resolver is read per request (no stale grant cache)', () => {
  const resolver = api('domains/client-operations/organization-client-access.ts');
  assert.match(resolver, /authorizedClientIdsForViewer/);
  assert.doesNotMatch(resolver, /const\s+\w*[Cc]ache\w*\s*=\s*new Map/);
});

test('24. registry cache key includes the access scope', () => {
  const cache = api('domains/client-operations/client-operations-registry-materialization-cache.ts');
  assert.match(cache, /accessScopeKey/);
});

// ── Direct ids (25–28) ──────────────────────────────────────────────────────

test('25. resource ids in query, body, payload and review blocks are collected', () => {
  const ids = collectIncomeRequestIds({
    path: '/x',
    query: { client_id: 'c1', draft_id: 'd1' },
    body: {
      represented_client_id: 'c2',
      payload: { income_document_id: 'i1', end_customer_id: 'u1', work_item_id: 'w1', reminder_candidate_id: 'r1' },
      recurring_cycle_review: { linked_work_item_id: 'w2' },
    },
  });
  assert.deepEqual(ids.client_ids.sort(), ['c1', 'c2']);
  assert.deepEqual(ids.draft_ids, ['d1']);
  assert.deepEqual(ids.income_document_ids, ['i1']);
  assert.deepEqual(ids.income_customer_ids, ['u1']);
  assert.deepEqual(ids.work_item_ids.sort(), ['w1', 'w2']);
  assert.deepEqual(ids.reminder_candidate_ids, ['r1']);
  assert.equal(incomeRequestHasResourceIds(ids), true);
});

test('26. path-borne document ids are collected; empty requests carry no ids', () => {
  const ids = collectIncomeRequestIds({ path: '/documents/abc%2D1/download' });
  assert.deepEqual(ids.income_document_ids, ['abc-1']);
  assert.equal(incomeRequestHasResourceIds(collectIncomeRequestIds({ path: '/ping', query: {}, body: {} })), false);
});

test('27. unknown or foreign ids use not-found semantics and are org-scoped', () => {
  const svc = api('domains/income/income-request-client-access.service.ts');
  assert.match(svc, /notFound\(/);
  assert.match(svc, /reminder_candidate_ids/);
  assert.match(svc, /work_reminder_candidates/);
  assert.match(svc, /\.eq\('org_id', orgId\)/);
  assert.match(svc, /\.eq\('organization_id', orgId\)/);
});

test('28. Income and Work Engine routers run the same resource-id guard before any handler', () => {
  for (const rel of ['domains/income/income.routes.ts', 'domains/work-engine/work-engine.routes.ts']) {
    const src = api(rel);
    assert.match(src, /assertIncomeRequestClientAccess\(/, rel);
    assert.match(src, /collectIncomeRequestIds\(/, rel);
  }
  const we = api('domains/work-engine/work-engine.routes.ts');
  assert.doesNotMatch(we, /String\(req\.query\.client_id \?\? body\.client_id/);
});

// ── Regression (29–33) ──────────────────────────────────────────────────────

test('29. no new authorization model: guards reuse the 5.1 resolver', () => {
  for (const rel of [
    'domains/documents/document-client-access.ts',
    'domains/work-engine/work-engine-client-scope.ts',
    'domains/income/income-request-client-access.service.ts',
  ]) {
    assert.match(api(rel), /organization-client-access\.js|authorizedClientIdsForViewer|assertCanAccessClientFromContext/, rel);
  }
});

test('30. Owner/Admin keep the unchanged SQL RPC path for DocFlow pages', () => {
  const inbox = api('domains/docflow/docflow-read-models.service.ts');
  assert.match(inbox, /docflow_office_inbox_clients_page/);
  const tc = api('domains/docflow/docflow-task-center.service.ts');
  assert.match(tc, /docflow_task_center_threads_page/);
});

test('31. migrations 184, 185, 186 are not modified by this stage and no new migration is required', () => {
  const m186 = readRepo('supabase/migrations/186_organization_member_module_access.sql');
  assert.match(m186, /set_organization_member_module_access/);
  // Stage 5.5 enforces assignability in TypeScript; the RPC is untouched.
  assert.doesNotMatch(m186, /Stage 5\.5/);
});

test('32. frontend stays dumb: Stage 5.5 adds no web client-ACL', () => {
  const shell = readRepo('apps/web/src/components/layout/AppShell.tsx');
  assert.doesNotMatch(shell, /authorized_client_ids/);
});

test('33. Work Engine foundation route and refresh pass the viewer', () => {
  assert.match(api('domains/work-engine/work-engine.routes.ts'), /buildWorkEngineFoundationAggregate\(\{[\s\S]{0,200}viewer/);
  assert.match(api('domains/work-engine/work-engine.commands.service.ts'), /buildWorkEngineFoundationAggregate\(\{[\s\S]{0,200}viewer/);
});
