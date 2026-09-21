import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_OPERATIONS_MODULE_CODE,
  buildOwnerModuleDetailTabs,
  filterPricingRowsForModule,
  isOwnerModulesCatalogRow,
  summarizeCatalogPlans,
} from '../../src/domains/owner-modules/owner-modules.pure.js';

test('Owner Modules catalog filter hides system, income alias, and inactive non-sellable rows', () => {
  assert.equal(
    isOwnerModulesCatalogRow({ code: 'client-operations', is_system: false, is_sellable: true, is_active: true }),
    true
  );
  assert.equal(
    isOwnerModulesCatalogRow({ code: 'core', is_system: true, is_sellable: false, is_active: true }),
    false
  );
  assert.equal(
    isOwnerModulesCatalogRow({ code: 'income', is_system: false, is_sellable: false, is_active: false }),
    false
  );
  assert.equal(
    isOwnerModulesCatalogRow({ code: 'docflow', is_system: false, is_sellable: true, is_active: false }),
    true
  );
});

test('Client Operations exposes Reporting Calendar tab without inventing legal dates', () => {
  const tabs = buildOwnerModuleDetailTabs(CLIENT_OPERATIONS_MODULE_CODE);
  assert.deepEqual(
    tabs.map((t) => t.tab_key),
    ['pricing', 'users', 'reporting_calendar']
  );
  const calendar = tabs.find((t) => t.tab_key === 'reporting_calendar');
  assert.ok(calendar);
  assert.equal(calendar?.unavailable_reason != null, true);
});

test('Other modules do not expose Reporting Calendar tab', () => {
  const tabs = buildOwnerModuleDetailTabs('payroll');
  assert.deepEqual(
    tabs.map((t) => t.tab_key),
    ['pricing', 'users']
  );
});

test('Pricing filter scopes rows to selected module_code only', () => {
  const scoped = filterPricingRowsForModule(
    {
      table: {
        rows: [
          { module_code: 'payroll', price_amount: 10 },
          { module_code: 'client-operations', price_amount: 20 },
        ],
      },
      module_catalog: {
        rows: [{ module_code: 'payroll' }, { module_code: 'client-operations' }],
      },
    },
    'client-operations'
  );
  const rows = (scoped.table as { rows: Array<{ module_code: string; price_amount: number }> }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.module_code, 'client-operations');
  assert.equal(rows[0]?.price_amount, 20);
});

test('Catalog plan summary prefers first active plan by sort_order', () => {
  const summary = summarizeCatalogPlans([
    { price_amount: 99, currency: 'ILS', billing_period: 'month', is_active: false, sort_order: 1 },
    { price_amount: 120, currency: 'ILS', billing_period: 'month', is_active: true, sort_order: 2 },
    { price_amount: 50, currency: 'ILS', billing_period: 'month', is_active: true, sort_order: 0 },
  ]);
  assert.equal(summary.base_price_amount, 50);
  assert.equal(summary.active_plan_count, 2);
  assert.equal(summary.price_summary_label, '50 ILS/month');
});
