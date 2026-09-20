import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendOwnerExternalUnresolvedReference,
  parseOwnerExternalReferencePayload,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-external-reference.pure.js';
import {
  countRegistryEntries,
  deriveRegistryResolutionStatus,
  deriveRegistryReviewStatus,
  deriveRegistrySourceStatus,
  isDuplicateDraftReference,
  isSameCategoryOwnerRef,
  lastOwnerReviewIsNotEffectiveDate,
  officialRegistryName,
  presentRegistryStatus,
  sourcedEffectiveFromOrNull,
  technicalTitleForPlaceholder,
} from '../../src/domains/tax-knowledge/tax-regulation-registry.pure.js';

test('TAX-652 category + Owner ref uniquely identifies a registry entry', () => {
  assert.equal(
    isSameCategoryOwnerRef(
      { tax_domain_id: 'income', owner_catalog_number: '17' },
      { tax_domain_id: 'income', owner_catalog_number: '17' },
    ),
    true,
  );
  assert.equal(
    isSameCategoryOwnerRef(
      { tax_domain_id: 'income', owner_catalog_number: '17' },
      { tax_domain_id: 'vat', owner_catalog_number: '17' },
    ),
    false,
  );
});

test('TAX-652 same Owner ref in two categories is allowed', () => {
  const income = { tax_domain_id: 'income', owner_catalog_number: '17' };
  const vat = { tax_domain_id: 'vat', owner_catalog_number: '17' };
  assert.equal(isSameCategoryOwnerRef(income, vat), false);
});

test('TAX-652 placeholder title stays unknown until Owner names it', () => {
  assert.equal(technicalTitleForPlaceholder('17'), '17');
  assert.equal(officialRegistryName('17', '17'), null);
  assert.equal(officialRegistryName('תקנות שווי שימוש', '17'), 'תקנות שווי שימוש');
});

test('TAX-652 duplicate pin is detected without a second placeholder', () => {
  assert.equal(
    isDuplicateDraftReference({
      existing: [{ tax_source_id: 'src-17', locator_text: '2(2)(ב)' }],
      tax_source_id: 'src-17',
      locator_text: '2(2)(ב)',
    }),
    true,
  );
  assert.equal(
    isDuplicateDraftReference({
      existing: [{ tax_source_id: 'src-17', locator_text: '2(2)(ב)' }],
      tax_source_id: 'src-18',
      locator_text: '2(2)(ב)',
    }),
    false,
  );
});

test('TAX-652 many-to-many pins stay independent', () => {
  const pins = [
    { tax_source_id: 'reg-17', locator_text: '2(2)(ב)' },
    { tax_source_id: 'reg-18', locator_text: '2(2)(ב)' },
    { tax_source_id: 'reg-17', locator_text: '2(2)(א)' },
  ];
  assert.equal(pins.filter((row) => row.tax_source_id === 'reg-17').length, 2);
  assert.equal(pins.filter((row) => row.locator_text === '2(2)(ב)').length, 2);
});

test('TAX-652 statuses are derived, not a new source enum', () => {
  assert.equal(deriveRegistrySourceStatus({ has_document: false, has_owner_legal_text: false }), 'missing');
  assert.equal(deriveRegistrySourceStatus({ has_document: true, has_owner_legal_text: false }), 'source_added');
  assert.equal(deriveRegistryReviewStatus({ has_ready_draft: false, has_owner_approved_proposal: false }), 'not_reviewed');
  assert.equal(deriveRegistryReviewStatus({ has_ready_draft: true, has_owner_approved_proposal: false }), 'reviewed');
  assert.equal(deriveRegistryResolutionStatus({ has_resolved_relationship: false }), 'unresolved');
  assert.equal(deriveRegistryResolutionStatus({ has_resolved_relationship: true }), 'resolved');
  assert.equal(presentRegistryStatus({
    source_status: 'missing',
    review_status: 'not_reviewed',
    resolution_status: 'unresolved',
  }).code, 'missing');
  assert.equal(presentRegistryStatus({
    source_status: 'source_added',
    review_status: 'not_reviewed',
    resolution_status: 'unresolved',
  }).code, 'source_added');
  assert.equal(presentRegistryStatus({
    source_status: 'source_added',
    review_status: 'reviewed',
    resolution_status: 'unresolved',
  }).code, 'reviewed');
  assert.equal(presentRegistryStatus({
    source_status: 'source_added',
    review_status: 'reviewed',
    resolution_status: 'resolved',
  }).code, 'resolved');
});

test('TAX-652 registry counts are backend-owned and do not invent totals', () => {
  const counts = countRegistryEntries([
    { source_status: 'missing', review_status: 'not_reviewed', resolution_status: 'unresolved' },
    { source_status: 'source_added', review_status: 'not_reviewed', resolution_status: 'unresolved' },
    { source_status: 'source_added', review_status: 'reviewed', resolution_status: 'unresolved' },
    { source_status: 'source_added', review_status: 'reviewed', resolution_status: 'resolved' },
  ]);
  assert.deepEqual(counts, { all: 4, missing: 1, needs_review: 1, reviewed: 2, unresolved: 3 });
});

test('TAX-652 last Owner review is not the legal effective date', () => {
  assert.equal(
    lastOwnerReviewIsNotEffectiveDate({
      last_owner_review_at: '2026-09-20T10:00:00.000Z',
      effective_from: '2025-01-01',
    }),
    true,
  );
});

test('TAX-652 unknown effective date is never defaulted to today', () => {
  assert.equal(sourcedEffectiveFromOrNull(null, '2026-09-20'), null);
  assert.equal(sourcedEffectiveFromOrNull('', '2026-09-20'), null);
  assert.equal(sourcedEffectiveFromOrNull('2026-09-20T00:00:00.000Z', '2026-09-20'), null);
  assert.equal(sourcedEffectiveFromOrNull('2025-01-01', '2026-09-20'), '2025-01-01');
});

test('TAX-652 Owner-confirmed external ref can carry source_tax_source_id without inventing a name', () => {
  const parsed = parseOwnerExternalReferencePayload({
    tax_knowledge_proposal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cited_law_name: 'תקנות מס הכנסה',
    locator_text: '2(2)(ב)',
    source_tax_source_id: '33333333-3333-4333-8333-333333333333',
    owner_catalog_number: '17',
  });
  assert.equal(parsed.source_tax_source_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(parsed.owner_catalog_number, '17');
  const next = appendOwnerExternalUnresolvedReference(
    {
      rules: [{ proposal_rule_key: 'r1', title: 'rule' }],
      relationships: [],
      uncertainties: [],
    },
    parsed,
  );
  const unresolved = (next.relationships as Array<Record<string, unknown>>)[0]?.unresolved as Record<string, unknown>;
  assert.equal(unresolved.source_tax_source_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(unresolved.owner_catalog_number, '17');
});
