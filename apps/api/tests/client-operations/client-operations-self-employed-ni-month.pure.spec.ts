import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSelfEmployedNiOperations,
  resolveSelfEmployedNiHandlingMethod,
  selfEmployedNiOfficeReminderActive,
  type SelfEmployedNiMonthSettingInput,
} from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

const here = dirname(fileURLToPath(import.meta.url));

function readSrc(relative: string): string {
  return readFileSync(join(here, relative), 'utf8');
}

function resolveMonth(
  periodKey: string,
  monthSettings: readonly SelfEmployedNiMonthSettingInput[],
  standingOrderUntil: string | null = null,
) {
  return resolveSelfEmployedNiHandlingMethod({ periodKey, monthSettings, standingOrderUntil });
}

test('1 September standing order remains unchanged after October changes to client pays', () => {
  const afterOctoberChange: SelfEmployedNiMonthSettingInput[] = [
    { period_key: '2026-09', handling_method: 'standing_order' },
    { period_key: '2026-10', handling_method: 'client_pays' },
  ];
  const september = resolveMonth('2026-09', afterOctoberChange);
  const october = resolveMonth('2026-10', afterOctoberChange);
  assert.equal(september.method, 'standing_order');
  assert.equal(september.source, 'explicit');
  assert.equal(october.method, 'client_pays');
  assert.equal(october.source, 'explicit');
});

test('2 October client pays remains unchanged after November changes to manual monthly', () => {
  const afterNovemberChange: SelfEmployedNiMonthSettingInput[] = [
    { period_key: '2026-09', handling_method: 'standing_order' },
    { period_key: '2026-10', handling_method: 'client_pays' },
    { period_key: '2026-11', handling_method: 'manual_monthly' },
  ];
  assert.equal(resolveMonth('2026-10', afterNovemberChange).method, 'client_pays');
  assert.equal(resolveMonth('2026-11', afterNovemberChange).method, 'manual_monthly');
  assert.equal(resolveMonth('2026-09', afterNovemberChange).method, 'standing_order');
});

test('3 changing an earlier month never overwrites an explicitly saved later month', () => {
  const before: SelfEmployedNiMonthSettingInput[] = [
    { period_key: '2026-09', handling_method: 'standing_order' },
    { period_key: '2026-11', handling_method: 'manual_monthly' },
  ];
  const afterEarlierChange: SelfEmployedNiMonthSettingInput[] = [
    { period_key: '2026-09', handling_method: 'standing_order' },
    { period_key: '2026-10', handling_method: 'client_pays' },
    { period_key: '2026-11', handling_method: 'manual_monthly' },
  ];
  assert.equal(resolveMonth('2026-11', before).method, 'manual_monthly');
  assert.equal(resolveMonth('2026-11', afterEarlierChange).method, 'manual_monthly');
  assert.equal(resolveMonth('2026-11', afterEarlierChange).source, 'explicit');
  assert.equal(resolveMonth('2026-10', afterEarlierChange).method, 'client_pays');
});

test('4 a new month inherits the latest applicable earlier method', () => {
  const settings: SelfEmployedNiMonthSettingInput[] = [
    { period_key: '2026-09', handling_method: 'standing_order' },
  ];
  const october = resolveMonth('2026-10', settings);
  assert.equal(october.method, 'standing_order');
  assert.equal(october.source, 'inherited');
  const clientPaysForward = resolveMonth('2026-12', [
    { period_key: '2026-10', handling_method: 'client_pays' },
  ]);
  assert.equal(clientPaysForward.method, 'client_pays');
  assert.equal(clientPaysForward.source, 'inherited');
});

test('5 January shows last year method but requires accountant confirmation', () => {
  const january = resolveMonth(
    '2027-01',
    [{ period_key: '2026-12', handling_method: 'standing_order' }],
    '2026-12-31',
  );
  assert.equal(january.method, 'standing_order');
  assert.equal(january.source, 'inherited');
  assert.equal(january.january_confirmation_required, true);
  const januaryClientPays = resolveMonth('2027-01', [
    { period_key: '2026-12', handling_method: 'client_pays' },
  ]);
  assert.equal(januaryClientPays.method, 'client_pays');
  assert.equal(januaryClientPays.source, 'inherited');
  assert.equal(januaryClientPays.january_confirmation_required, true);
  const februaryWithoutJanuary = resolveMonth('2027-02', [
    { period_key: '2026-12', handling_method: 'client_pays' },
  ]);
  assert.equal(februaryWithoutJanuary.method, null);
  assert.equal(februaryWithoutJanuary.source, 'unresolved');
  assert.equal(februaryWithoutJanuary.january_confirmation_required, false);
  const afterJanuaryConfirm = [
    { period_key: '2026-12', handling_method: 'standing_order' },
    { period_key: '2027-01', handling_method: 'client_pays' },
  ];
  const confirmedJanuary = resolveMonth('2027-01', afterJanuaryConfirm);
  assert.equal(confirmedJanuary.method, 'client_pays');
  assert.equal(confirmedJanuary.source, 'explicit');
  assert.equal(confirmedJanuary.january_confirmation_required, false);
  const february = resolveMonth('2027-02', afterJanuaryConfirm);
  assert.equal(february.method, 'client_pays');
  assert.equal(february.source, 'inherited');
  assert.equal(february.january_confirmation_required, false);
  const januaryAlert = buildSelfEmployedNiOperations({
    applicable: true,
    periodKey: '2027-01',
    today: '2027-01-05',
    obligationStatus: 'not_paid',
    monthSettings: [{ period_key: '2026-12', handling_method: 'standing_order' }],
  });
  assert.equal(januaryAlert.january_confirmation_required, true);
  assert.equal(januaryAlert.office_reminder, false);
  assert.equal(januaryAlert.ni_indicator_alert, true);
  const januaryManualUnconfirmed = selfEmployedNiOfficeReminderActive({
    applicable: true,
    periodKey: '2027-01',
    today: '2027-01-20',
    obligationStatus: 'not_paid',
    monthSettings: [{ period_key: '2026-12', handling_method: 'manual_monthly' }],
  });
  assert.equal(januaryManualUnconfirmed, false);
});

test('6 two offices with the same identity number remain isolated by organization_id + client_id', () => {
  const officeA = resolveMonth('2026-09', [{ period_key: '2026-09', handling_method: 'standing_order' }]);
  const officeB = resolveMonth('2026-09', [{ period_key: '2026-09', handling_method: 'client_pays' }]);
  assert.equal(officeA.method, 'standing_order');
  assert.equal(officeB.method, 'client_pays');
  const migration = readSrc('../../../../supabase/migrations/209_client_operations_self_employed_ni_month_settings.sql');
  assert.match(migration, /unique \(organization_id, client_id, period_key\)/);
  assert.doesNotMatch(migration, /tax_id/);
  assert.doesNotMatch(migration, /תעודת זהות/);
  const persist = readSrc('../../src/domains/client-operations/client-operations-self-employed-ni-month.service.ts');
  assert.match(persist, /\.eq\('organization_id', input\.organizationId\)/);
  assert.match(persist, /\.eq\('client_id', input\.clientId\)/);
  assert.doesNotMatch(persist, /tax_id/);
});

test('7 every method change writes an immutable handling-method audit entry', () => {
  const persist = readSrc('../../src/domains/client-operations/client-operations-self-employed-ni-month.service.ts');
  assert.match(persist, /CLIENT_OPERATIONS_NI_HANDLING_METHOD_SET/);
  assert.match(persist, /operational_period_key: input\.periodKey/);
  assert.match(persist, /previous_handling_method: before\.method/);
  assert.match(persist, /handling_method: input\.handlingMethod/);
  assert.match(persist, /actorUserId: input\.actorUserId/);
  assert.doesNotMatch(persist, /tax_id/);
  assert.doesNotMatch(persist, /from\('audit_log'\)\.delete/);
});

test('8 monthly handling completion affects only the selected month', () => {
  const command = readSrc('../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts');
  assert.match(command, /\.eq\('period_key', periodKey\)/);
  assert.match(command, /obligation_type: 'national_insurance_self_employed_payment'/);
  assert.doesNotMatch(command, /national_insurance_self_employed_payment'\)\s*\.eq\('is_active'/);
  const persist = readSrc('../../src/domains/client-operations/client-operations-self-employed-ni-month.service.ts');
  assert.match(persist, /period_key: input\.periodKey/);
  assert.doesNotMatch(persist, /from\('client_obligations'\)/);
});

test('9-10 reminder tone uses the selected month effective method only', () => {
  const manualBefore = selfEmployedNiOfficeReminderActive({
    applicable: true,
    periodKey: '2026-10',
    today: '2026-10-14',
    obligationStatus: 'not_paid',
    monthSettings: [{ period_key: '2026-10', handling_method: 'manual_monthly' }],
  });
  const manualFrom15th = selfEmployedNiOfficeReminderActive({
    applicable: true,
    periodKey: '2026-10',
    today: '2026-10-15',
    obligationStatus: 'not_paid',
    monthSettings: [{ period_key: '2026-10', handling_method: 'manual_monthly' }],
  });
  const standing = selfEmployedNiOfficeReminderActive({
    applicable: true,
    periodKey: '2026-10',
    today: '2026-10-20',
    obligationStatus: 'not_paid',
    monthSettings: [{ period_key: '2026-10', handling_method: 'standing_order' }],
  });
  const clientPays = selfEmployedNiOfficeReminderActive({
    applicable: true,
    periodKey: '2026-10',
    today: '2026-10-20',
    obligationStatus: 'not_paid',
    monthSettings: [{ period_key: '2026-10', handling_method: 'client_pays' }],
  });
  const unresolved = selfEmployedNiOfficeReminderActive({
    applicable: true,
    periodKey: '2026-10',
    today: '2026-10-20',
    obligationStatus: 'not_paid',
    monthSettings: [],
  });
  assert.equal(manualBefore, false);
  assert.equal(manualFrom15th, true);
  assert.equal(standing, false);
  assert.equal(clientPays, false);
  assert.equal(unresolved, false);
  const septemberManual = buildSelfEmployedNiOperations({
    applicable: true,
    periodKey: '2026-09',
    today: '2026-10-20',
    obligationStatus: 'not_paid',
    monthSettings: [
      { period_key: '2026-09', handling_method: 'manual_monthly' },
      { period_key: '2026-10', handling_method: 'client_pays' },
    ],
  });
  const octoberClientPays = buildSelfEmployedNiOperations({
    applicable: true,
    periodKey: '2026-10',
    today: '2026-10-20',
    obligationStatus: 'not_paid',
    monthSettings: [
      { period_key: '2026-09', handling_method: 'manual_monthly' },
      { period_key: '2026-10', handling_method: 'client_pays' },
    ],
  });
  assert.equal(septemberManual.office_reminder, true);
  assert.equal(octoberClientPays.office_reminder, false);
});

test('11 legacy standing-order records stay standing_until without invented monthly selections', () => {
  const covered = resolveMonth('2026-09', [], '2026-12-31');
  assert.equal(covered.method, 'standing_order');
  assert.equal(covered.source, 'standing_until');
  assert.equal(covered.legacy_standing_until_ambiguous, true);
  const migration = readSrc('../../../../supabase/migrations/209_client_operations_self_employed_ni_month_settings.sql');
  assert.match(migration, /Do not backfill monthly rows from standing_order_until/);
  assert.doesNotMatch(migration, /insert into public\.client_operations_self_employed_ni_month_settings/);
});

test('12 old and new NI commands cannot corrupt monthly history', () => {
  const obligations = readSrc('../../src/domains/client-operations/client-obligations-tasks-core.service.ts');
  const standingCase = obligations.slice(
    obligations.indexOf("case 'set_ni_standing_order':"),
    obligations.indexOf("case 'update_ni_payment_amount':"),
  );
  assert.match(standingCase, /persistSelfEmployedNiMonthSetting/);
  assert.match(standingCase, /periodKey: niRel\.period_key/);
  assert.doesNotMatch(standingCase, /national_insurance_standing_order_until:/);
  assert.doesNotMatch(standingCase, /status: 'paid_on_time'/);
  assert.doesNotMatch(standingCase, /\.eq\('is_active', true\)/);
  const command = readSrc('../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts');
  const saveCase = command.slice(
    command.indexOf("command === 'save_client_operations_self_employed_ni'"),
    command.indexOf("command === 'archive_client_operations_custom_column'"),
  );
  assert.match(saveCase, /persistSelfEmployedNiMonthSetting/);
  assert.doesNotMatch(saveCase, /national_insurance_standing_order_until:/);
  assert.doesNotMatch(saveCase, /national_insurance_self_employed_handling_year/);
  assert.match(obligations, /computed_status: 'not_paid'/);
  assert.doesNotMatch(obligations, /niStandingOrderOverridesNotPaid/);
});

test('13 filing KPIs still ignore national insurance', () => {
  const kpiSource = readSrc('../../src/domains/client-operations/client-operations-reporting-dashboard.pure.ts');
  assert.match(kpiSource, /reportingKindAffectsFilingKpi/);
  const persist = readSrc('../../src/domains/client-operations/client-operations-self-employed-ni-month.service.ts');
  assert.doesNotMatch(persist, /reportingKindAffectsFilingKpi/);
});
