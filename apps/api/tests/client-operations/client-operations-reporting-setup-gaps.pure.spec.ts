import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPORTING_SETUP_WARNING_SOURCE,
  buildClientNeedingSetup,
  buildClientsNeedingSetupAggregate,
  clientReportingSetupGaps,
} from '../../src/domains/client-operations/client-operations-reporting-setup-gaps.pure.js';

test('empty business type and VAT applicability are required; optional choose-fields are not', () => {
  const empty = clientReportingSetupGaps({
    business_type: null,
    vat_type: null,
    vat_frequency: null,
    vat_due_type: null,
  });
  assert.deepEqual(empty.missing, ['business_type', 'vat_applicability']);
  assert.ok(empty.blocked.includes('reporting_obligation_scope'));
  assert.ok(empty.blocked.includes('vat_reporting_obligation'));
  assert.equal(empty.missing.includes('vat_frequency'), false);

  const configuredNoVat = clientReportingSetupGaps({
    business_type: 'osek_murshe',
    vat_type: 'no',
    vat_frequency: null,
    vat_due_type: null,
  });
  assert.deepEqual(configuredNoVat.missing, []);
  assert.deepEqual(configuredNoVat.blocked, []);
});

test('VAT yes without frequency or due type blocks periodicity and due, not optional NI/advances', () => {
  const gaps = clientReportingSetupGaps({
    business_type: 'osek_murshe',
    vat_type: 'yes',
    vat_frequency: '',
    vat_due_type: null,
  });
  assert.deepEqual(gaps.missing, ['vat_frequency', 'vat_due_type']);
  assert.deepEqual(gaps.blocked, ['vat_reporting_periodicity', 'vat_reporting_due']);
});

test('patur VAT does not require frequency or due type', () => {
  const gaps = clientReportingSetupGaps({
    business_type: 'osek_patur',
    vat_type: 'patur',
    vat_frequency: null,
    vat_due_type: null,
  });
  assert.deepEqual(gaps.missing, []);
});

test('aggregate fingerprint changes when a missing setting is completed', () => {
  const first = buildClientNeedingSetup({
    client_id: 'c1',
    display_name: 'אלפא',
    gap: clientReportingSetupGaps({
      business_type: null,
      vat_type: null,
      vat_frequency: null,
      vat_due_type: null,
    }),
  });
  const complete = buildClientsNeedingSetupAggregate([first]);
  assert.equal(complete.source, REPORTING_SETUP_WARNING_SOURCE);
  assert.equal(complete.count, 1);
  assert.match(first.settings_href, /tab=taxes/);
  const after = buildClientsNeedingSetupAggregate([]);
  assert.equal(after.count, 0);
  assert.notEqual(after.fingerprint, complete.fingerprint);
});
