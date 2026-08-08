/**
 * INV-13A — Pure structural mutations on Owner layout definition (draft only).
 */

import { badRequest } from '../../shared/errors.js';
import {
  assertSectionAllowedForField,
  fieldHideRejectedReason,
  findOwnerInvoiceFieldCatalogEntry,
} from './owner-invoice-document-field-catalog.pure.js';
import {
  assertSectionResizeWithinBounds,
  parseAndValidateOwnerInvoiceLayoutDefinition,
} from './owner-invoice-document-layout-schema.pure.js';
import type {
  OwnerInvoiceLayoutDefinitionV1,
  OwnerInvoiceLayoutSectionKey,
  OwnerInvoiceLayoutStatus,
} from './owner-invoice-document-layout.types.js';

export function assertOwnerInvoiceLayoutVersionMutable(status: OwnerInvoiceLayoutStatus): void {
  if (status !== 'draft') {
    throw badRequest(
      `Owner invoice layout version is ${status} and immutable`,
      'OWNER_INVOICE_LAYOUT_IMMUTABLE',
    );
  }
}

function cloneDefinition(definition: OwnerInvoiceLayoutDefinitionV1): OwnerInvoiceLayoutDefinitionV1 {
  return parseAndValidateOwnerInvoiceLayoutDefinition(
    JSON.parse(JSON.stringify(definition)) as unknown,
  );
}

export function moveOwnerInvoiceLayoutSection(
  definition: OwnerInvoiceLayoutDefinitionV1,
  params: { section_key: string; order?: number; col_start?: number },
): OwnerInvoiceLayoutDefinitionV1 {
  const next = cloneDefinition(definition);
  const section = next.sections.find((s) => s.key === params.section_key);
  if (!section) throw badRequest(`Unknown section_key: ${params.section_key}`);
  if (section.owner_locked && params.col_start != null && params.col_start !== section.col_start) {
    throw badRequest(`Section ${section.key} is owner_locked for column moves`);
  }
  if (params.order != null) {
    if (!Number.isInteger(params.order) || params.order < 0) {
      throw badRequest('order invalid');
    }
    section.order = params.order;
  }
  if (params.col_start != null) {
    assertSectionResizeWithinBounds({ section, col_start: params.col_start });
    section.col_start = params.col_start;
  }
  next.sections.sort((a, b) => a.order - b.order);
  return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}

export function resizeOwnerInvoiceLayoutSection(
  definition: OwnerInvoiceLayoutDefinitionV1,
  params: { section_key: string; height_px?: number; col_span?: number },
): OwnerInvoiceLayoutDefinitionV1 {
  const next = cloneDefinition(definition);
  const section = next.sections.find((s) => s.key === params.section_key);
  if (!section) throw badRequest(`Unknown section_key: ${params.section_key}`);
  if (section.owner_locked) {
    throw badRequest(`Section ${section.key} is owner_locked and cannot be resized`);
  }
  const height_px = params.height_px ?? section.height_px;
  const col_span = params.col_span ?? section.col_span;
  assertSectionResizeWithinBounds({ section, height_px, col_span });
  section.height_px = height_px;
  section.col_span = col_span;
  return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}

export function moveOwnerInvoiceLayoutField(
  definition: OwnerInvoiceLayoutDefinitionV1,
  params: { field_key: string; section_key?: string; order?: number },
): OwnerInvoiceLayoutDefinitionV1 {
  const next = cloneDefinition(definition);
  const field = next.fields.find((f) => f.field_key === params.field_key);
  if (!field) throw badRequest(`Unknown field_key: ${params.field_key}`);
  const catalog = findOwnerInvoiceFieldCatalogEntry(field.field_key);
  if (!catalog?.move_allowed || field.owner_locked) {
    throw badRequest(`Field ${field.field_key} cannot be moved`);
  }
  if (params.section_key != null) {
    const sectionKey = params.section_key as OwnerInvoiceLayoutSectionKey;
    try {
      assertSectionAllowedForField(field.field_key, sectionKey);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Field section move rejected');
    }
    if (!next.sections.some((s) => s.key === sectionKey)) {
      throw badRequest(`Unknown section_key: ${params.section_key}`);
    }
    field.section_key = sectionKey;
  }
  if (params.order != null) {
    if (!Number.isInteger(params.order) || params.order < 0) throw badRequest('order invalid');
    field.order = params.order;
  }
  return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}

export function setOwnerInvoiceFieldVisibility(
  definition: OwnerInvoiceLayoutDefinitionV1,
  params: { field_key: string; visible: boolean },
): OwnerInvoiceLayoutDefinitionV1 {
  const next = cloneDefinition(definition);
  const field = next.fields.find((f) => f.field_key === params.field_key);
  if (!field) throw badRequest(`Unknown field_key: ${params.field_key}`);
  if (!params.visible) {
    const reason = fieldHideRejectedReason(field.field_key);
    if (reason) throw badRequest(reason, 'OWNER_INVOICE_FIELD_HIDE_REJECTED');
  }
  field.visible = params.visible;
  return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}

export function setOwnerInvoiceTableColumn(
  definition: OwnerInvoiceLayoutDefinitionV1,
  params: {
    column_key: string;
    visible?: boolean;
    width_px?: number | null;
    order?: number;
    align?: 'start' | 'center' | 'end';
  },
): OwnerInvoiceLayoutDefinitionV1 {
  const next = cloneDefinition(definition);
  const col = next.table.columns.find((c) => c.key === params.column_key);
  if (!col) throw badRequest(`Unknown table column: ${params.column_key}`);
  if (col.owner_locked) {
    throw badRequest(`Table column ${col.key} is owner_locked`);
  }
  if (params.visible != null) col.visible = params.visible;
  if (params.width_px !== undefined) col.width_px = params.width_px;
  if (params.order != null) {
    if (!Number.isInteger(params.order) || params.order < 0) throw badRequest('order invalid');
    col.order = params.order;
  }
  if (params.align != null) col.align = params.align;
  next.table.columns.sort((a, b) => a.order - b.order);
  return parseAndValidateOwnerInvoiceLayoutDefinition(next);
}

/** Pure publish transition: archive previous published ids, mark target published. */
export function planPublishOwnerInvoiceLayoutVersion(params: {
  target_id: string;
  target_status: OwnerInvoiceLayoutStatus;
  currently_published_ids: string[];
}): { archive_ids: string[]; publish_id: string } {
  if (params.target_status !== 'draft') {
    throw badRequest('Only draft versions can be published', 'OWNER_INVOICE_LAYOUT_PUBLISH_INVALID');
  }
  const archive_ids = params.currently_published_ids.filter((id) => id !== params.target_id);
  return { archive_ids, publish_id: params.target_id };
}
