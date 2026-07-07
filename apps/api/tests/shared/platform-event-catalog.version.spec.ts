import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
  INCOME_WORK_EVENTS_DEFERRED,
} from '../../src/domains/income/income-work-engine-bridge.pure.js';
import { knownEventTypes } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';
import {
  getPlatformEventCatalogEntry,
  isKnownPlatformEventType,
  listPlatformEventCatalogEntries,
  PLATFORM_EVENT_CATALOG,
} from '../../src/shared/platform-event-catalog.js';
import {
  assertSupportedPlatformEventVersion,
  getPlatformEventSchemaVersion,
  isSupportedPlatformEventVersion,
} from '../../src/shared/platform-event-catalog.version.js';

const dir = dirname(fileURLToPath(import.meta.url));
const intakeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.event-intake.service.ts'),
  'utf8',
);

test('every catalog entry has schema_version and all current events are v1', () => {
  for (const row of PLATFORM_EVENT_CATALOG) {
    assert.equal(typeof row.schema_version, 'number');
    assert.equal(Number.isInteger(row.schema_version), true);
    assert.equal(row.schema_version, 1);
  }
});

test('getPlatformEventSchemaVersion returns 1 for known events', () => {
  assert.equal(getPlatformEventSchemaVersion('income.invoice_overdue'), 1);
  assert.equal(getPlatformEventSchemaVersion('docflow.thread_needs_attention'), 1);
});

test('isSupportedPlatformEventVersion accepts known v1 and rejects unsupported versions', () => {
  assert.equal(isSupportedPlatformEventVersion('income.document_issued', 1), true);
  assert.equal(isSupportedPlatformEventVersion('income.document_issued', 2), false);
  assert.equal(isSupportedPlatformEventVersion('not.a.real.event', 1), false);
  assert.equal(isSupportedPlatformEventVersion('income.document_issued', undefined), false);
  assert.equal(isSupportedPlatformEventVersion('income.document_issued', null), false);
});

test('assertSupportedPlatformEventVersion throws for unknown and unsupported versions', () => {
  assert.throws(
    () => assertSupportedPlatformEventVersion('unknown.event', 1),
    (err: { code?: string }) => err.code === 'platform_event_unknown',
  );
  assert.throws(
    () => assertSupportedPlatformEventVersion('income.document_issued', 2),
    (err: { code?: string }) => err.code === 'platform_event_schema_version_unsupported',
  );
  assert.throws(
    () => assertSupportedPlatformEventVersion('income.document_issued', undefined),
    (err: { code?: string }) => err.code === 'platform_event_schema_version_invalid',
  );
});

test('fact-consumed income delivery events are catalogued with supported v1', () => {
  for (const eventType of [
    INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
    INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
  ]) {
    assert.equal(isKnownPlatformEventType(eventType), true);
    assert.equal(isSupportedPlatformEventVersion(eventType, 1), true);
    assert.equal(getPlatformEventSchemaVersion(eventType), 1);
  }
});

test('deferred income events are catalogued but not Work Engine allowlisted', () => {
  const allowlisted = new Set(knownEventTypes());
  for (const eventType of INCOME_WORK_EVENTS_DEFERRED) {
    assert.equal(isKnownPlatformEventType(eventType), true);
    assert.equal(isSupportedPlatformEventVersion(eventType, 1), true);
    assert.equal(allowlisted.has(eventType), false);
  }
});

test('Work Engine allowlist events are present in catalog with supported v1', () => {
  for (const eventType of knownEventTypes()) {
    const row = getPlatformEventCatalogEntry(eventType);
    assert.ok(row, `missing catalog row for allowlisted ${eventType}`);
    assert.equal(row!.schema_version, 1);
    assert.equal(isSupportedPlatformEventVersion(eventType, 1), true);
  }
});

test('drift guard: catalog entries must declare schema_version', () => {
  for (const row of listPlatformEventCatalogEntries()) {
    assert.ok('schema_version' in row);
    assert.equal(typeof row.schema_version, 'number');
  }
});

test('drift guard: allowlist cannot contain events missing from catalog', () => {
  for (const eventType of knownEventTypes()) {
    assert.equal(
      isKnownPlatformEventType(eventType),
      true,
      `allowlisted event missing from catalog: ${eventType}`,
    );
  }
});

test('intake envelope connects catalog version guard for known platform events', () => {
  assert.match(intakeSource, /assertCatalogPlatformEventVersionIfKnown/);
  assert.match(intakeSource, /schema_version must be an integer >= 1/);
});
