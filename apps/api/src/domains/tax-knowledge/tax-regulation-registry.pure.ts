export const REGULATION_REGISTRY_PROVENANCE = ['regulation', 'order'] as const;
export type RegulationRegistryProvenance = (typeof REGULATION_REGISTRY_PROVENANCE)[number];

export const REGULATION_REGISTRY_SOURCE_STATUSES = ['missing', 'source_added'] as const;
export const REGULATION_REGISTRY_REVIEW_STATUSES = ['not_reviewed', 'reviewed'] as const;
export const REGULATION_REGISTRY_RESOLUTION_STATUSES = ['unresolved', 'resolved'] as const;

export type RegulationRegistrySourceStatus = (typeof REGULATION_REGISTRY_SOURCE_STATUSES)[number];
export type RegulationRegistryReviewStatus = (typeof REGULATION_REGISTRY_REVIEW_STATUSES)[number];
export type RegulationRegistryResolutionStatus = (typeof REGULATION_REGISTRY_RESOLUTION_STATUSES)[number];

export type RegulationRegistryCounts = {
  all: number;
  missing: number;
  needs_review: number;
  reviewed: number;
  unresolved: number;
};

export function parseOwnerCatalogNumber(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  if (!raw) throw new Error('owner_catalog_number is required');
  if (raw.length > 32) throw new Error('owner_catalog_number is too long');
  return raw;
}

export function parseOwnerCatalogYear(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const year = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(year) || year < 1800 || year > 2200) {
    throw new Error('owner_catalog_year is invalid');
  }
  return year;
}

export function isRegulationRegistryProvenance(value: unknown): value is RegulationRegistryProvenance {
  return typeof value === 'string' && (REGULATION_REGISTRY_PROVENANCE as readonly string[]).includes(value);
}

export function technicalTitleForPlaceholder(ownerCatalogNumber: string): string {
  return ownerCatalogNumber;
}

export function officialRegistryName(title: string | null | undefined, ownerCatalogNumber: string): string | null {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed || trimmed === ownerCatalogNumber) return null;
  return trimmed;
}

export function regulationReferenceLabel(categoryTitle: string | null | undefined, ownerCatalogNumber: string): string {
  return [typeof categoryTitle === 'string' ? categoryTitle.trim() : '', ownerCatalogNumber.trim()].filter(Boolean).join(' · ');
}

export function yearFromPublishedOn(publishedOn: string | null | undefined): number | null {
  if (typeof publishedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) return null;
  return Number(publishedOn.slice(0, 4));
}

export function deriveRegistrySourceStatus(input: {
  has_document: boolean;
  has_owner_legal_text: boolean;
}): RegulationRegistrySourceStatus {
  return input.has_document || input.has_owner_legal_text ? 'source_added' : 'missing';
}

export function deriveRegistryReviewStatus(input: {
  has_ready_draft: boolean;
  has_owner_approved_proposal: boolean;
}): RegulationRegistryReviewStatus {
  return input.has_ready_draft || input.has_owner_approved_proposal ? 'reviewed' : 'not_reviewed';
}

export function deriveRegistryResolutionStatus(input: { has_resolved_relationship: boolean }): RegulationRegistryResolutionStatus {
  return input.has_resolved_relationship ? 'resolved' : 'unresolved';
}

export function presentRegistryStatus(input: {
  source_status: RegulationRegistrySourceStatus;
  review_status: RegulationRegistryReviewStatus;
  resolution_status: RegulationRegistryResolutionStatus;
}): { code: string; label: string } {
  if (input.resolution_status === 'resolved') return { code: 'resolved', label: 'Resolved' };
  if (input.review_status === 'reviewed') return { code: 'reviewed', label: 'Reviewed' };
  if (input.source_status === 'source_added') return { code: 'source_added', label: 'Source added' };
  return { code: 'missing', label: 'Missing' };
}

export function emptyRegistryCounts(): RegulationRegistryCounts {
  return { all: 0, missing: 0, needs_review: 0, reviewed: 0, unresolved: 0 };
}

export function countRegistryEntries(
  rows: Array<{
    source_status: RegulationRegistrySourceStatus;
    review_status: RegulationRegistryReviewStatus;
    resolution_status: RegulationRegistryResolutionStatus;
  }>,
): RegulationRegistryCounts {
  const counts = emptyRegistryCounts();
  counts.all = rows.length;
  for (const row of rows) {
    if (row.source_status === 'missing') counts.missing += 1;
    if (row.review_status === 'not_reviewed' && row.source_status === 'source_added') counts.needs_review += 1;
    if (row.review_status === 'reviewed') counts.reviewed += 1;
    if (row.resolution_status === 'unresolved') counts.unresolved += 1;
  }
  return counts;
}

export function isSameCategoryOwnerRef(
  left: { tax_domain_id: string; owner_catalog_number: string },
  right: { tax_domain_id: string; owner_catalog_number: string },
): boolean {
  return left.tax_domain_id === right.tax_domain_id && left.owner_catalog_number === right.owner_catalog_number;
}

export function isDuplicateDraftReference(input: {
  existing: Array<{ tax_source_id: string; locator_text: string }>;
  tax_source_id: string;
  locator_text: string;
}): boolean {
  const locator = input.locator_text.trim();
  return input.existing.some((row) => row.tax_source_id === input.tax_source_id && row.locator_text.trim() === locator);
}

export function lastOwnerReviewIsNotEffectiveDate(input: {
  last_owner_review_at: string | null;
  effective_from: string | null;
}): boolean {
  if (!input.last_owner_review_at || !input.effective_from) return true;
  return input.last_owner_review_at.slice(0, 10) !== input.effective_from;
}

export function sourcedEffectiveFromOrNull(value: string | null | undefined, _todayIsoDate?: string): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}
