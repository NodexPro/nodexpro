import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceScheduledDocumentDate,
  formatScheduleRowDateDisplay,
  generateProjectedScheduleDates,
  groupScheduleDatesByYear,
  mergeScheduleDates,
  resolveNextScheduleSummaryDocumentDate,
  resolveProjectedNextScheduleDate,
  resolveScheduleEndDate,
  resolveScheduleStartDate,
  recurringSchedulePeriodIdentity,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-projection.pure.js';

test('monthly schedule from 20.06.2026 through Dec 2026', () => {
  const start = '2026-06-20';
  const end = resolveScheduleEndDate({ scheduleStartDate: start, servicePeriodEnd: null });
  const dates = generateProjectedScheduleDates({
    scheduleStartDate: start,
    scheduleEndDate: end,
    frequency: 'monthly',
    includeFutureProjections: true,
  });
  const year2026 = groupScheduleDatesByYear(dates).find((group) => group.year === 2026);
  assert.ok(year2026);
  assert.deepEqual(year2026?.dates, [
    '2026-06-20',
    '2026-07-20',
    '2026-08-20',
    '2026-09-20',
    '2026-10-20',
    '2026-11-20',
    '2026-12-20',
  ]);
});

test('yearly schedule shows one row per year', () => {
  const start = '2026-06-20';
  const end = resolveScheduleEndDate({ scheduleStartDate: start, servicePeriodEnd: null });
  const dates = generateProjectedScheduleDates({
    scheduleStartDate: start,
    scheduleEndDate: end,
    frequency: 'yearly',
    includeFutureProjections: true,
  });
  const grouped = groupScheduleDatesByYear(dates);
  assert.equal(grouped.find((g) => g.year === 2026)?.dates.length, 1);
  assert.equal(grouped.find((g) => g.year === 2027)?.dates.length, 1);
  assert.equal(grouped.find((g) => g.year === 2028)?.dates.length, 1);
  assert.equal(advanceScheduledDocumentDate('2026-06-20', 'yearly'), '2027-06-20');
});

test('semi annual schedule shows two rows per year', () => {
  const start = '2026-06-20';
  const end = '2027-12-31';
  const dates = generateProjectedScheduleDates({
    scheduleStartDate: start,
    scheduleEndDate: end,
    frequency: 'semi_annual',
    includeFutureProjections: true,
  });
  assert.deepEqual(
    groupScheduleDatesByYear(dates).find((g) => g.year === 2026)?.dates,
    ['2026-06-20', '2026-12-20'],
  );
  assert.deepEqual(
    groupScheduleDatesByYear(dates).find((g) => g.year === 2027)?.dates,
    ['2027-06-20', '2027-12-20'],
  );
});

test('end date stops projection rows', () => {
  const start = '2026-06-20';
  const end = resolveScheduleEndDate({
    scheduleStartDate: start,
    servicePeriodEnd: '2026-09-15',
  });
  const dates = generateProjectedScheduleDates({
    scheduleStartDate: start,
    scheduleEndDate: end,
    frequency: 'monthly',
    includeFutureProjections: true,
  });
  assert.deepEqual(dates, ['2026-06-20', '2026-07-20', '2026-08-20']);
});

test('cancelled profile yields no projected dates', () => {
  const start = resolveScheduleStartDate({
    templateDocumentDate: '2026-06-20',
    servicePeriodStart: '2026-06-20',
    nextDocumentDate: '2026-09-20',
  });
  assert.equal(start, '2026-06-20');
  const dates = generateProjectedScheduleDates({
    scheduleStartDate: start!,
    scheduleEndDate: '2031-06-20',
    frequency: 'monthly',
    includeFutureProjections: false,
  });
  assert.deepEqual(dates, []);
});

test('days_30 advances by exact day interval', () => {
  assert.equal(advanceScheduledDocumentDate('2026-06-20', 'days_30'), '2026-07-20');
});

test('resolveProjectedNextScheduleDate uses template cadence not scheduler cursor', () => {
  const nextIso = resolveProjectedNextScheduleDate({
    templateDocumentDate: '2026-06-23',
    servicePeriodStart: '2026-06-20',
    nextDocumentDate: '2026-08-19',
    servicePeriodEnd: null,
    frequency: 'days_30',
    profileStatus: 'active',
    cycles: [],
    todayIso: '2026-06-26',
  });
  assert.equal(nextIso, '2026-07-23');
  assert.equal(formatScheduleRowDateDisplay(nextIso!), '23.07.2026');
});

test('summary next document uses first future scheduled row from template cadence', () => {
  const start = resolveScheduleStartDate({
    templateDocumentDate: '2026-06-23',
    servicePeriodStart: '2026-06-20',
    nextDocumentDate: '2026-08-19',
  });
  assert.equal(start, '2026-06-23');

  const end = resolveScheduleEndDate({ scheduleStartDate: start!, servicePeriodEnd: null });
  const allDates = generateProjectedScheduleDates({
    scheduleStartDate: start!,
    scheduleEndDate: end,
    frequency: 'days_30',
    includeFutureProjections: true,
  });
  assert.deepEqual(allDates.slice(0, 4), [
    '2026-06-23',
    '2026-07-23',
    '2026-08-22',
    '2026-09-21',
  ]);

  const nextIso = resolveNextScheduleSummaryDocumentDate({
    allDates,
    today: '2026-06-26',
    cyclesByDate: new Map(),
  });
  assert.equal(nextIso, '2026-07-23');
  assert.equal(formatScheduleRowDateDisplay(nextIso!), '23.07.2026');
  assert.notEqual(nextIso, '2026-08-19');
});

test('summary next document skips issued future rows', () => {
  const allDates = ['2026-06-23', '2026-07-23', '2026-08-22'];
  const nextIso = resolveNextScheduleSummaryDocumentDate({
    allDates,
    today: '2026-06-26',
    cyclesByDate: new Map([
      ['2026-07-23', { status: 'issued', generated_document_id: 'doc-1' }],
    ]),
  });
  assert.equal(nextIso, '2026-08-22');
});

test('summary next document is null when no future scheduled rows remain', () => {
  const allDates = ['2026-06-23', '2026-07-23'];
  const nextIso = resolveNextScheduleSummaryDocumentDate({
    allDates,
    today: '2026-08-01',
    cyclesByDate: new Map([
      ['2026-07-23', { status: 'issued', generated_document_id: 'doc-1' }],
    ]),
  });
  assert.equal(nextIso, null);
});

test('monthly period identity is YYYY-MM not issue date', () => {
  assert.equal(recurringSchedulePeriodIdentity('monthly', '2026-08-01'), '2026-08');
  assert.equal(recurringSchedulePeriodIdentity('monthly', '2026-08-23'), '2026-08');
  assert.equal(recurringSchedulePeriodIdentity('days_30', '2026-08-23'), '2026-08-23');
});

test('monthly profile produces one period per calendar month', () => {
  const projected = generateProjectedScheduleDates({
    scheduleStartDate: '2026-07-23',
    scheduleEndDate: '2026-10-23',
    frequency: 'monthly',
    includeFutureProjections: true,
  });
  assert.deepEqual(projected, [
    '2026-07-23',
    '2026-08-23',
    '2026-09-23',
    '2026-10-23',
  ]);
  const months = projected.map((d) => recurringSchedulePeriodIdentity('monthly', d));
  assert.deepEqual(months, ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(new Set(months).size, months.length);
});

test('issued August cycle suppresses second August projection with different day', () => {
  const projected = [
    '2026-07-23',
    '2026-08-23',
    '2026-09-23',
    '2026-10-23',
  ];
  const merged = mergeScheduleDates({
    projectedDates: projected,
    frequency: 'monthly',
    cycles: [
      {
        scheduled_document_date: '2026-08-01',
        status: 'issued',
        generated_document_id: 'doc-aug',
      },
    ],
  });
  const august = merged.filter((d) => d.startsWith('2026-08'));
  assert.deepEqual(august, ['2026-08-01']);
  assert.ok(!merged.includes('2026-08-23'));
  assert.ok(merged.includes('2026-09-23'));
});

test('changed actual issue date does not create another August period', () => {
  // Cycle scheduled period remains August; document may have been issued on 07.08.
  const merged = mergeScheduleDates({
    projectedDates: ['2026-07-23', '2026-08-23', '2026-09-23'],
    frequency: 'monthly',
    cycles: [
      {
        scheduled_document_date: '2026-08-01',
        status: 'issued',
        generated_document_id: 'doc-aug',
      },
    ],
  });
  assert.equal(
    merged.filter((d) => recurringSchedulePeriodIdentity('monthly', d) === '2026-08').length,
    1,
  );
});

test('next period after issued August is September', () => {
  const allDates = mergeScheduleDates({
    projectedDates: ['2026-07-23', '2026-08-23', '2026-09-23', '2026-10-23'],
    frequency: 'monthly',
    cycles: [
      {
        scheduled_document_date: '2026-08-01',
        status: 'issued',
        generated_document_id: 'doc-aug',
      },
    ],
  });
  const nextIso = resolveNextScheduleSummaryDocumentDate({
    allDates,
    today: '2026-08-07',
    cyclesByDate: new Map([
      ['2026-08-01', { status: 'issued', generated_document_id: 'doc-aug' }],
    ]),
  });
  assert.equal(nextIso, '2026-09-23');
});

test('resolveProjectedNextScheduleDate after issued August returns September', () => {
  const nextIso = resolveProjectedNextScheduleDate({
    templateDocumentDate: '2026-07-23',
    servicePeriodStart: '2026-07-01',
    nextDocumentDate: '2026-09-01',
    servicePeriodEnd: null,
    frequency: 'monthly',
    profileStatus: 'active',
    cycles: [
      {
        scheduled_document_date: '2026-08-01',
        status: 'issued',
        generated_document_id: 'doc-aug',
      },
    ],
    todayIso: '2026-08-07',
  });
  assert.equal(nextIso, '2026-09-23');
});
