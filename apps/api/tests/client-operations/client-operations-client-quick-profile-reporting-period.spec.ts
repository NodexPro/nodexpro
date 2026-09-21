/**
 * Quick Profile reporting-period selection — monthly vs bi-monthly VAT,
 * PCN period key identity, deductions frequency gates.
 * Pure only (no network). Frontend remains unaware of these rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIncomeTaxDeductionsOperationalReportingPeriodKey,
  resolveOperationalReportingPeriodKey,
  resolveVatOperationalReportingPeriodKey,
} from '../../src/domains/client-operations/client-operations-client-quick-profile.pure.js';
import {
  biMonthlyVatPairEndPeriodKey,
  isFilingDueDateAfterReportingPeriodEnd,
  isVatReportingPeriodApplicable,
} from '../../src/domains/country-pack/reporting-calendar.pure.js';

/** Fixed Asia/Jerusalem wall times (UTC+2 winter / +3 summer — use noon UTC+3 safe midday). */
function atJerusalem(isoLocal: string): Date {
  // isoLocal: '2026-02-15T12:00:00' interpreted as Asia/Jerusalem via explicit offset +02:00/+03:00
  // Use +03:00 for 2026 spring/summer months under test (Feb still +02, Mar+ after DST).
  // Prefer Date constructed from Jerusalem calendar by appending Z-equivalent via offset.
  return new Date(isoLocal);
}

test('baseline resolveOperationalReportingPeriodKey = prior Jerusalem month', () => {
  // 15 Mar 2026 12:00 Asia/Jerusalem = 10:00 UTC (IST+2 until late Mar; use explicit +02:00)
  assert.equal(
    resolveOperationalReportingPeriodKey(new Date('2026-03-15T12:00:00+02:00')),
    '2026-02'
  );
  assert.equal(
    resolveOperationalReportingPeriodKey(new Date('2026-02-10T12:00:00+02:00')),
    '2026-01'
  );
});

test('monthly VAT: period = prior month; always applicable', () => {
  const now = new Date('2026-03-15T12:00:00+02:00');
  const key = resolveVatOperationalReportingPeriodKey({
    vat_frequency: 'monthly',
    now,
  });
  assert.equal(key, '2026-02');
  assert.equal(
    isVatReportingPeriodApplicable({ vat_frequency: 'monthly', reporting_period_key: key! }),
    true
  );
});

test('bi-monthly VAT: Feb→2025-11, Mar→2026-01, Apr→2026-01, May→2026-03', () => {
  const cases: Array<[string, string]> = [
    ['2026-02-15T12:00:00+02:00', '2025-11'], // prior Jan odd → completed Nov–Dec pair
    ['2026-03-15T12:00:00+02:00', '2026-01'], // prior Feb even → Jan–Feb pair
    ['2026-04-15T12:00:00+03:00', '2026-01'], // prior Mar odd → still Jan–Feb completed
    ['2026-05-15T12:00:00+03:00', '2026-03'], // prior Apr even → Mar–Apr pair
  ];
  for (const [iso, expected] of cases) {
    const key = resolveVatOperationalReportingPeriodKey({
      vat_frequency: 'bi_monthly',
      now: new Date(iso),
    });
    assert.equal(key, expected, `now=${iso}`);
    assert.equal(
      isVatReportingPeriodApplicable({
        vat_frequency: 'bi_monthly',
        reporting_period_key: key!,
      }),
      true,
      `period ${key} must be applicable for bi_monthly`
    );
  }
});

test('bi-monthly: naive prior month would be non-applicable in Mar/May — fix avoids that', () => {
  const mar = new Date('2026-03-15T12:00:00+02:00');
  const naive = resolveOperationalReportingPeriodKey(mar);
  assert.equal(naive, '2026-02');
  assert.equal(
    isVatReportingPeriodApplicable({
      vat_frequency: 'bi_monthly',
      reporting_period_key: naive!,
    }),
    false,
    'naive prior month Feb is NOT applicable for bi_monthly'
  );
  const fixed = resolveVatOperationalReportingPeriodKey({
    vat_frequency: 'bi_monthly',
    now: mar,
  });
  assert.equal(fixed, '2026-01');
  assert.equal(
    isVatReportingPeriodApplicable({
      vat_frequency: 'bi_monthly',
      reporting_period_key: fixed!,
    }),
    true
  );
});

test('PCN + bi-monthly uses same period key as regular (obligation differs in resolver, not period)', () => {
  const now = new Date('2026-04-15T12:00:00+03:00');
  const key = resolveVatOperationalReportingPeriodKey({
    vat_frequency: 'bi_monthly',
    now,
  });
  assert.equal(key, '2026-01');
  // Period applicability is frequency-only — PCN vs regular is obligation key, not period.
  assert.equal(
    isVatReportingPeriodApplicable({
      vat_frequency: 'bi_monthly',
      reporting_period_key: key!,
    }),
    true
  );
});

test('vat not_relevant → null period (row omitted upstream)', () => {
  assert.equal(
    resolveVatOperationalReportingPeriodKey({
      vat_frequency: 'not_relevant',
      now: new Date('2026-03-15T12:00:00+02:00'),
    }),
    null
  );
});

test('reporting_period_key is the tax period, not the filing-due month', () => {
  // Period Jan–Feb (key 2026-01) files in March — period key must stay 2026-01, not 2026-03.
  const key = resolveVatOperationalReportingPeriodKey({
    vat_frequency: 'bi_monthly',
    now: new Date('2026-03-20T12:00:00+02:00'),
  });
  assert.equal(key, '2026-01');
  assert.notEqual(key, '2026-03');
});

test('advances canonical period remains prior month (no invented bi-monthly walk)', () => {
  // Documented: CO obligations use businessPreviousMonthKey; frequency not applied to period.
  assert.equal(
    resolveOperationalReportingPeriodKey(new Date('2026-03-15T12:00:00+02:00')),
    '2026-02'
  );
  assert.equal(
    resolveOperationalReportingPeriodKey(new Date('2026-04-15T12:00:00+03:00')),
    '2026-03'
  );
});

test('deductions monthly → prior month; bi_monthly gates non-filing months', () => {
  const monthly = resolveIncomeTaxDeductionsOperationalReportingPeriodKey({
    frequency: 'monthly',
    now: new Date('2026-04-10T12:00:00+03:00'),
  });
  assert.deepEqual(monthly, { applicable: true, reporting_period_key: '2026-03' });

  const biEven = resolveIncomeTaxDeductionsOperationalReportingPeriodKey({
    frequency: 'bi_monthly',
    now: new Date('2026-04-10T12:00:00+03:00'),
  });
  assert.equal(biEven.applicable, false);

  const biOdd = resolveIncomeTaxDeductionsOperationalReportingPeriodKey({
    frequency: 'bi_monthly',
    now: new Date('2026-03-10T12:00:00+02:00'),
  });
  assert.equal(biOdd.applicable, true);
  assert.equal(biOdd.reporting_period_key, '2026-02'); // pair end month (CO m2)
});

test('service wires distinct VAT vs baseline periods (source contract)', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = dirname(fileURLToPath(import.meta.url));
  const service = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-client-quick-profile.service.ts'),
    'utf8'
  );
  assert.match(service, /resolveVatOperationalReportingPeriodKey/);
  assert.match(service, /resolveIncomeTaxDeductionsOperationalReportingPeriodKey/);
  assert.match(service, /resolveReportingDueDatesBatch/);
  assert.match(service, /resolveVatOperationalCalendarLookupPeriodKey/);
  // Distinct period keys: VAT identity, advances baseline, deductions period — one batched Country Pack read.
  assert.match(
    service,
    /vat_reporting_period_key:\s*vatReportingPeriodKey/
  );
  assert.match(
    service,
    /reporting_period_key:\s*reportingPeriodKey/
  );
  assert.match(
    service,
    /deductions_reporting_period_key:\s*deductionsPeriod\.reporting_period_key/
  );
});

test('2026-09-21 bi-monthly: identity 2026-07, calendar lookup 2026-08 (pair end)', () => {
  const now = new Date('2026-09-21T12:00:00+03:00');
  const identity = resolveVatOperationalReportingPeriodKey({
    vat_frequency: 'bi_monthly',
    now,
  });
  assert.equal(identity, '2026-07');
  assert.equal(biMonthlyVatPairEndPeriodKey(identity!), '2026-08');
  assert.equal(
    isVatReportingPeriodApplicable({
      vat_frequency: 'bi_monthly',
      reporting_period_key: identity!,
    }),
    true
  );
});

test('bi-monthly filing date mid-pair is rejected by completion invariant', () => {
  // Official monthly July row due 2026-08-17 cannot represent Jul-Aug bi-monthly filing.
  assert.equal(
    isFilingDueDateAfterReportingPeriodEnd('2026-08-17', '2026-08'),
    false
  );
  // Pair-end August row due 2026-09-24 is after Aug 31.
  assert.equal(
    isFilingDueDateAfterReportingPeriodEnd('2026-09-24', '2026-08'),
    true
  );
});

test('regular and PCN bi-monthly share pair identity; only obligation differs upstream', () => {
  const now = new Date('2026-09-21T12:00:00+03:00');
  const identity = resolveVatOperationalReportingPeriodKey({
    vat_frequency: 'bi_monthly',
    now,
  });
  assert.equal(identity, '2026-07');
  assert.equal(biMonthlyVatPairEndPeriodKey(identity!), '2026-08');
});

