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

test('Hebrew and English V2.1 labels cover churn, breakdown, and missing-agreement copy', () => {
  const he = officeCopy('he');
  const en = officeCopy('en');
  assert.equal(he.kpi_left, 'לקוחות שעזבו');
  assert.equal(en.kpi_left, 'Clients who left');
  assert.equal(he.breakdown_title, 'פירוט שכ״ט חודשי');
  assert.equal(en.breakdown_title, 'Monthly fee breakdown');
  assert.equal(he.cat_no_agreement, 'לא הוגדר הסכם שכ״ט');
  assert.equal(en.cat_no_agreement, 'No fee agreement');
  assert.equal(he.kpi_debtors, 'לקוחות עם חוב למשרד');
  assert.equal(he.kpi_new_clients, 'לקוחות חדשים');
  assert.equal(he.kpi_active, 'לקוחות פעילים');
  assert.match(he.kpi_expected_year_unavailable, /אין סכום שנתי מהימן/);
  assert.match(en.historical_unavailable, /Historical fees cannot be reconstructed/);
  assert.equal(he.missing_empty, 'לכל הלקוחות הוגדר שכ״ט');
  assert.equal(he.indicator_zero_fee, 'שכ״ט 0 ₪');
  assert.equal(he.cat_no_agreement, 'לא הוגדר הסכם שכ״ט');
  assert.equal(en.indicator_zero_fee, '₪0 fee');
  assert.equal(en.deadlines_title, 'Upcoming reports');
  assert.equal(he.breakdown_filter_no_fee, 'ללא שכ״ט');
  assert.equal(en.breakdown_filter_no_fee, 'No fee');
  assert.equal(he.breakdown_filter_zero_fee, 'שכ״ט 0 ₪');
  assert.equal(en.breakdown_filter_zero_fee, 'Zero fee');
  assert.equal(he.breakdown_filter_one_time, 'חד-פעמי');
  assert.equal(en.breakdown_filter_one_time, 'One time');
});
