import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCOME_WORK_EVENT_DOCUMENT_ISSUED,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
  INCOME_WORK_EVENT_OVERDUE,
  INCOME_WORK_EVENTS_DEFERRED,
} from '../../src/domains/income/income-work-engine-bridge.pure.js';
import { knownEventTypes } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';
import {
  RECURRING_APPROVED_EVENT_TYPE,
  RECURRING_WORK_EVENT_TYPE,
} from '../../src/domains/work-engine/work-engine-invoice-retainer.pure.js';
import {
  getPlatformEventCatalogEntry,
  isKnownPlatformEventType,
  listPlatformEventCatalogEntries,
  listPlatformEventTypes,
  PLATFORM_EVENT_ANNUAL_REPORT_DOCUMENTS_MISSING,
  PLATFORM_EVENT_CATALOG,
  PLATFORM_EVENT_DOCFLOW_THREAD_NEEDS_ATTENTION,
  PLATFORM_EVENT_PAYROLL_DOCUMENTS_MISSING,
  PLATFORM_EVENT_VAT_DOCUMENTS_MISSING,
} from '../../src/shared/platform-event-catalog.js';

test('platform event catalog exposes required metadata fields', () => {
  for (const row of PLATFORM_EVENT_CATALOG) {
    assert.ok(row.event_type.length > 0);
    assert.ok(row.owner_module.length > 0);
    assert.equal(typeof row.schema_version, 'number');
    assert.ok(row.description.length > 0);
    assert.ok(Array.isArray(row.consumer_modules));
  }
});

test('platform event catalog has unique event_type values', () => {
  const types = listPlatformEventTypes();
  assert.equal(new Set(types).size, types.length);
});

test('every Work Engine allowlisted event_type is in the platform catalog', () => {
  for (const eventType of knownEventTypes()) {
    assert.equal(isKnownPlatformEventType(eventType), true, `missing catalog row for ${eventType}`);
    const row = getPlatformEventCatalogEntry(eventType);
    assert.ok(row);
    assert.ok(row!.consumer_modules.includes('work_engine'));
  }
});

test('income bridge constants resolve through the catalog', () => {
  assert.equal(
    getPlatformEventCatalogEntry(INCOME_WORK_EVENT_DOCUMENT_ISSUED)?.owner_module,
    'income',
  );
  assert.equal(
    getPlatformEventCatalogEntry(INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL)?.schema_version,
    1,
  );
  assert.equal(
    getPlatformEventCatalogEntry(INCOME_WORK_EVENT_OVERDUE)?.description.includes('invoice_collection_followup'),
    true,
  );
});

test('deferred income events are catalogued without work_engine consumers', () => {
  for (const eventType of INCOME_WORK_EVENTS_DEFERRED) {
    const row = getPlatformEventCatalogEntry(eventType);
    assert.ok(row);
    assert.equal(row!.consumer_modules.length, 0);
  }
});

test('retainer audit-only event is catalogued', () => {
  const row = getPlatformEventCatalogEntry(RECURRING_APPROVED_EVENT_TYPE);
  assert.ok(row);
  assert.equal(row!.owner_module, 'work_engine');
  assert.match(row!.description, /audit-only/i);
});

test('docflow, payroll, vat, and annual_report events are present', () => {
  assert.ok(getPlatformEventCatalogEntry(PLATFORM_EVENT_DOCFLOW_THREAD_NEEDS_ATTENTION));
  assert.ok(getPlatformEventCatalogEntry(PLATFORM_EVENT_PAYROLL_DOCUMENTS_MISSING));
  assert.ok(getPlatformEventCatalogEntry(PLATFORM_EVENT_VAT_DOCUMENTS_MISSING));
  assert.ok(getPlatformEventCatalogEntry(PLATFORM_EVENT_ANNUAL_REPORT_DOCUMENTS_MISSING));
});

test('catalog covers all module families requested for P11.1', () => {
  const owners = new Set(listPlatformEventCatalogEntries().map((row) => row.owner_module));
  for (const module of [
    'income',
    'work_engine',
    'docflow',
    'client_operations',
    'payroll',
    'vat',
    'annual_report',
  ]) {
    assert.equal(owners.has(module), true, `missing owner_module ${module}`);
  }
});

test('retainer mapped event is catalogued', () => {
  assert.ok(getPlatformEventCatalogEntry(RECURRING_WORK_EVENT_TYPE));
});
