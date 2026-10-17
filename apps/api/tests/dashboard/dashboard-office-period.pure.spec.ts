import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDashboardPeriodKey,
  resolveDashboardPeriodWindow,
  lastNJerusalemMonths,
} from '../../src/domains/dashboard/dashboard-office-period.pure.js';

test('parseDashboardPeriodKey defaults unknown values to current_month', () => {
  assert.equal(parseDashboardPeriodKey('current_year'), 'current_year');
  assert.equal(parseDashboardPeriodKey('custom'), 'current_month');
  assert.equal(parseDashboardPeriodKey(undefined), 'current_month');
});

test('current month window uses Asia/Jerusalem calendar bounds', () => {
  const now = new Date('2026-10-17T02:30:00.000Z');
  const w = resolveDashboardPeriodWindow(now, 'current_month', 'he');
  assert.equal(w.start_date, '2026-10-01');
  assert.equal(w.end_date, '2026-10-31');
  assert.equal(w.label_he, 'חודש נוכחי');
});

test('period labels follow the requested dashboard locale', () => {
  const now = new Date('2026-10-17T02:30:00.000Z');
  const en = resolveDashboardPeriodWindow(now, 'current_month', 'en');
  assert.equal(en.label_he, 'Current month');
});

test('previous month wraps year at January', () => {
  const now = new Date('2026-01-05T10:00:00.000Z');
  const w = resolveDashboardPeriodWindow(now, 'previous_month');
  assert.equal(w.start_date, '2025-12-01');
  assert.equal(w.end_date, '2025-12-31');
});

test('current year covers Jan 1 through Dec 31 in Jerusalem', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');
  const w = resolveDashboardPeriodWindow(now, 'current_year');
  assert.equal(w.start_date, '2026-01-01');
  assert.equal(w.end_date, '2026-12-31');
});

test('lastNJerusalemMonths returns chronological keys including current month', () => {
  const months = lastNJerusalemMonths(new Date('2026-10-17T12:00:00.000Z'), 6);
  assert.deepEqual(
    months.map((m) => m.month_key),
    ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  );
});
