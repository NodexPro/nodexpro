import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obligationWritePersisted } from '../../src/domains/client-operations/client-operations-filing-command.pure.js';
import { SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS } from '../../src/domains/client-operations/client-operations-registry-incremental.pure.js';
import { vatFilingPeriodIdentityForOperationalPeriod } from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';
import {
  canStartFilingAction,
  filingAggregateConfirmsAction,
  filingCellPresentationClass,
  filingChromeConfirmsAction,
} from '../../../web/src/lib/client-operations-filing-result.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('obligation status write is persisted only when a row is updated', () => {
  assert.equal(obligationWritePersisted({ error: null, rowCount: 1 }), true);
  assert.equal(obligationWritePersisted({ error: null, rowCount: 0 }), false);
  assert.equal(obligationWritePersisted({ error: new Error('rejected'), rowCount: 1 }), false);
});

test('filing commands refresh one client instead of rebuilding the registry', () => {
  for (const command of [
    'mark_client_operations_obligation_reported',
    'mark_client_operations_obligation_not_reported',
    'confirm_client_operations_obligation_filed_with_payment',
    'confirm_client_operations_obligation_tax_payment',
    'attach_client_operations_filing_evidence',
  ]) {
    assert.equal(SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS.has(command), true, command);
  }
});

test('selected tab period maps to the VAT filing identity before a report is accepted', () => {
  const monthly = vatFilingPeriodIdentityForOperationalPeriod({
    vat_frequency: 'monthly',
    operational_period_key: '2026-10',
  });
  const bimonthly = vatFilingPeriodIdentityForOperationalPeriod({
    vat_frequency: 'bi_monthly',
    operational_period_key: '2026-10',
  });
  assert.equal(monthly?.period_key, '2026-10');
  assert.equal(bimonthly?.period_key, '2026-09-10');
});

test('success is allowed only when the refreshed aggregate chrome matches the action', () => {
  const aggregate = {
    rows: [
      {
        client_id: 'c1',
        reporting: {
          cells: {
            vat: { filing_detail: { chrome: 'filed_unpaid' } },
            income_tax_advance: { filing_detail: { chrome: 'filed_paid' } },
          },
        },
      },
    ],
  };
  assert.equal(filingChromeConfirmsAction('report', 'filed_unpaid'), true);
  assert.equal(filingChromeConfirmsAction('report', 'filed_paid'), true);
  assert.equal(filingChromeConfirmsAction('report', 'pending'), false);
  assert.equal(filingChromeConfirmsAction('paid', 'filed_unpaid'), false);
  assert.equal(filingChromeConfirmsAction('report_and_pay', 'filed_paid'), true);
  assert.equal(
    filingAggregateConfirmsAction({
      action: 'report',
      clientId: 'c1',
      columnKey: 'vat',
      aggregate,
    }),
    true,
  );
  assert.equal(
    filingAggregateConfirmsAction({
      action: 'paid',
      clientId: 'c1',
      columnKey: 'vat',
      aggregate,
    }),
    false,
  );
  assert.equal(
    filingAggregateConfirmsAction({
      action: 'report',
      clientId: 'other',
      columnKey: 'vat',
      aggregate,
    }),
    false,
  );
});

test('filed chrome paints a cell state and an open cell does not invent one', () => {
  assert.equal(
    filingCellPresentationClass({ filing_detail: { chrome: 'filed_unpaid' }, tone: 'warning' }),
    'is-filing-chrome-filed_unpaid',
  );
  assert.equal(
    filingCellPresentationClass({ filing_detail: { chrome: 'filed_paid' }, tone: 'submitted' }),
    'is-filing-chrome-filed_paid',
  );
  assert.equal(filingCellPresentationClass({ filing_detail: { chrome: 'pending' }, tone: 'warning' }), '');
  assert.equal(filingCellPresentationClass({ tone: 'warning' }), 'is-reporting-cell-warning');
});

test('a filing action already in flight cannot start a second command', () => {
  assert.equal(canStartFilingAction(false), true);
  assert.equal(canStartFilingAction(true), false);
});

test('the filing modal stays open and success depends on the refreshed aggregate', () => {
  const view = read('../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx');
  const action = view.slice(view.indexOf('const runFilingAction'), view.indexOf('const attachFilingEvidence'));
  assert.match(action, /requireApplied: true/);
  assert.match(action, /filingAggregateConfirmsAction/);
  assert.match(action, /filing\.notConfirmed/);
  assert.doesNotMatch(action, /setFilingModal\(null\)/);
  assert.match(view, /data-testid="client-operations-filing-result"/);
  assert.match(view, /nx-co-filing-details/);
  assert.match(view, /nx-co-filing-actions/);
  const css = read('../../../web/src/styles/nx-client-operations-spreadsheet.css');
  assert.match(css, /\.nx-co-sheet__ni-clip \{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(css, /rgba\(234, 179, 8/);
  assert.match(css, /is-filing-chrome-filed_unpaid/);
  assert.match(css, /rgba\(19, 191, 208, 0\.12\)/);
});

test('mark reported rejects a write that did not update a row', () => {
  const source = read('../../src/domains/client-operations/client-obligations-tasks-core.service.ts');
  assert.match(source, /obligationWritePersisted/);
  assert.match(source, /OBLIGATION_FILING_NOT_RECORDED/);
  assert.match(source, /\.select\('id'\)/);
});
