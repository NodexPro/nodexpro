import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceScheduledDocumentDate,
  generateProjectedScheduleDates,
  groupScheduleDatesByYear,
  resolveScheduleEndDate,
  resolveScheduleStartDate,
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
