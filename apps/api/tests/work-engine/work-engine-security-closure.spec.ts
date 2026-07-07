/**
 * P11.3 — Work Engine security closure contract gates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assertIncomeDocumentIntakeOwnership,
  type IncomeDocumentIntakeOwnershipContext,
} from '../../src/domains/work-engine/work-engine-income-intake.guards.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(dir, '../../src');

function readSrc(...parts: string[]): string {
  return readFileSync(join(apiSrc, ...parts), 'utf8');
}

const routesSource = readSrc('domains/work-engine/work-engine.routes.ts');
const commandsSource = readSrc('domains/work-engine/work-engine.commands.service.ts');
const incomeRoutesSource = readSrc('domains/income/income.routes.ts');
const docflowRoutesSource = readSrc('routes/docflow.routes.ts');
const clientOpsRoutesSource = readSrc('domains/client-operations/client-operations.routes.ts');

const AGGREGATE_ROUTES = [
  '/aggregates/foundation',
  '/aggregates/queue',
  '/aggregates/invoices-tab',
  '/aggregates/invoices-client-documents-by-type',
  '/aggregates/invoice-retainer-setup',
  '/aggregates/clients-tab',
] as const;

test('work engine office router requires module activation', () => {
  assert.match(
    routesSource,
    /officeRouter\.use\(authMiddleware,\s*requireOrg,\s*requireModuleActive\(WORK_ENGINE_MODULE_CODE\)\)/,
  );
});

for (const route of AGGREGATE_ROUTES) {
  test(`work engine aggregate ${route} requires work_engine.view`, () => {
    const pattern = new RegExp(
      `['"]${route.replace(/\//g, '\\/')}['"][\\s\\S]*?requirePermission\\(WORK_ENGINE_PERMISSIONS\\.view\\)`,
    );
    assert.match(routesSource, pattern, `${route} must require work_engine.view`);
  });
}

test('work engine clients-tab aggregate requires client_operations.view', () => {
  assert.match(
    routesSource,
    /\/aggregates\/clients-tab[\s\S]*requirePermission\('client_operations\.view'\)/,
  );
});

test('work engine legacy event intake requires work_engine.write', () => {
  assert.match(
    routesSource,
    /\/events\/intake[\s\S]*requirePermission\(WORK_ENGINE_PERMISSIONS\.write\)/,
  );
});

test('module inactive: requireModuleActive middleware is shared platform pattern', () => {
  const middleware = readSrc('middleware/requireModuleActive.ts');
  assert.match(middleware, /Module not active for this organization/);
  assert.match(middleware, /AUDIT_ACTIONS\.MODULE_ACCESS_DENIED/);
});

test('missing permission: aggregate routes use requirePermission middleware', () => {
  assert.match(routesSource, /requirePermission\(WORK_ENGINE_PERMISSIONS\.view\)/);
});

test('missing permission: create_work_item command requires work_engine.write', () => {
  assert.match(
    commandsSource,
    /case 'create_work_item':[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.write\)/,
  );
});

test('missing permission: change_work_state command requires work_engine.write', () => {
  assert.match(
    commandsSource,
    /case 'change_work_state':[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.write\)/,
  );
});

test('missing permission: append_work_event command requires work_engine.write', () => {
  assert.match(
    commandsSource,
    /case 'append_work_event':[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.write\)/,
  );
});

test('missing permission: set_work_deadline override path requires work_engine.override', () => {
  assert.match(
    commandsSource,
    /case 'set_work_deadline':[\s\S]*isOverride[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.override\)/,
  );
});

test('missing permission: intake_work_event command requires work_engine.write', () => {
  assert.match(
    commandsSource,
    /case 'intake_work_event':[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.write\)/,
  );
});

test('correct permission: assign_work_item command requires work_engine.assign', () => {
  assert.match(
    commandsSource,
    /case 'assign_work_item':[\s\S]*requireWorkEnginePermission\(ctx, WORK_ENGINE_PERMISSIONS\.assign\)/,
  );
});

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherOrgId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

test('tenant mismatch: income document intake rejects foreign org', () => {
  assert.throws(
    () =>
      assertIncomeDocumentIntakeOwnership(
        {
          organization_id: otherOrgId,
          represented_client_id: clientId,
          document_status: 'issued',
        },
        {
          org_id: orgId,
          client_id: clientId,
          source_module: 'income',
          source_entity_type: 'income_document',
          source_entity_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          event_type: 'income.invoice_overdue',
        } satisfies IncomeDocumentIntakeOwnershipContext,
      ),
    (err: { code?: string }) => err.code === 'income_document_org_mismatch',
  );
});

test('tenant mismatch: legacy event intake route enforces envelope org_id', () => {
  assert.match(routesSource, /env\.org_id !== ctx\.organizationId/);
  assert.match(routesSource, /event_org_mismatch/);
});

test('security regression: income routes still require module activation', () => {
  assert.match(
    incomeRoutesSource,
    /requireModuleActive\(INCOME_MODULE_CODE\)/,
  );
});

test('security regression: docflow office routes still require module activation', () => {
  assert.match(
    docflowRoutesSource,
    /officeRouter\.use\(authMiddleware,\s*requireOrg,\s*requireModuleActive\('docflow'\)\)/,
  );
});

test('security regression: client operations routes still require module activation', () => {
  assert.match(
    clientOpsRoutesSource,
    /requireModuleActive\(MODULE_CODE\)/,
  );
});

test('migration seeds work_engine module registry for requireModuleActive', () => {
  const migration = readFileSync(
    join(dir, '../../../../supabase/migrations/146_work_engine_module_registry.sql'),
    'utf8',
  );
  assert.match(migration, /insert into public\.modules/);
  assert.match(migration, /'work_engine'/);
  assert.match(migration, /insert into public\.organization_modules/);
});
