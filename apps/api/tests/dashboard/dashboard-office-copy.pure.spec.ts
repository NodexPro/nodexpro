import assert from 'node:assert/strict';
import test from 'node:test';
import { officeCopy, parseDashboardLocale } from '../../src/domains/dashboard/dashboard-office-copy.pure.js';

test('parseDashboardLocale treats Hebrew tags as he and everything else as en', () => {
  assert.equal(parseDashboardLocale('he'), 'he');
  assert.equal(parseDashboardLocale('he-IL'), 'he');
  assert.equal(parseDashboardLocale('en'), 'en');
  assert.equal(parseDashboardLocale(undefined), 'en');
  assert.equal(parseDashboardLocale('fr'), 'en');
});

test('Hebrew expected-fees KPI keeps the product label', () => {
  assert.equal(officeCopy('he').kpi_expected_fees, 'הכנסה חודשית צפויה משכ״ט');
  assert.equal(officeCopy('he').missing_title, 'לקוחות ללא שכ״ט מוגדר');
  assert.equal(officeCopy('en').kpi_expected_fees, 'Expected monthly office fees');
});
