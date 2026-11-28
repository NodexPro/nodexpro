import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPORTING_SETUP_WARNING_SOURCE,
  buildClientNeedingSetup,
  buildClientsNeedingSetupAggregate,
  clientReportingSetupGaps,
  formatClientsAddedGeneration,
  setupWarningVisible,
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

test('VAT yes without frequency blocks periodicity; vat_due_type is not a client-setup gap', () => {
  const gaps = clientReportingSetupGaps({
    business_type: 'osek_murshe',
    vat_type: 'yes',
    vat_frequency: '',
    vat_due_type: null,
  });
  assert.deepEqual(gaps.missing, ['vat_frequency']);
  assert.deepEqual(gaps.blocked, ['vat_reporting_periodicity']);
  assert.equal(gaps.missing.includes('vat_due_type' as never), false);
});

test('VAT yes with frequency does not require vat_due_type', () => {
  const gaps = clientReportingSetupGaps({
    business_type: 'osek_murshe',
    vat_type: 'yes',
    vat_frequency: 'monthly',
    vat_due_type: null,
  });
  assert.deepEqual(gaps.missing, []);
  assert.deepEqual(gaps.blocked, []);
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
  const withToken = buildClientsNeedingSetupAggregate([first], '1');
  assert.equal(withToken.clients_added_token, '1');
  assert.equal(withToken.visible, true);
  assert.equal(withToken.dismissed, false);
  assert.equal(withToken.dont_show_again_key, 'clientOperations.setupWarning.dontShowUntilNewClient');
  const hidden = buildClientsNeedingSetupAggregate([first], '1', '1');
  assert.equal(hidden.visible, false);
  assert.equal(hidden.dismissed, true);
});

test('clients-added generation is numeric, monotonic on add, and stable across archive', () => {
  assert.equal(formatClientsAddedGeneration(9), '9');
  assert.equal(formatClientsAddedGeneration(10n), '10');
  assert.equal(formatClientsAddedGeneration('10'), '10');
  assert.equal(formatClientsAddedGeneration('0000000002:t1:a'), '');
  const dismissedAtNine = '9';
  assert.equal(
    setupWarningVisible({
      count: 1,
      clientsAddedToken: '10',
      dismissedClientsAddedToken: dismissedAtNine,
    }),
    true,
  );
  assert.equal(
    setupWarningVisible({
      count: 1,
      clientsAddedToken: '9',
      dismissedClientsAddedToken: dismissedAtNine,
    }),
    false,
  );
  assert.equal(
    setupWarningVisible({
      count: 4,
      clientsAddedToken: '9',
      dismissedClientsAddedToken: dismissedAtNine,
    }),
    false,
    'archive reduces live count but must not reopen a dismissed warning',
  );
});
