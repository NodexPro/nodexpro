/**
 * INV-13C — Universal Document Template Registry.
 * Country Pack / future modules register families here; Invoice is first active family.
 */

import {
  buildInvoiceFamilyWidgetCatalog,
  INVOICE_SECTION_LABELS,
  INVOICE_TEMPLATE_FAMILY,
} from './owner-document-invoice-family.adapter.pure.js';
import type {
  OwnerDocumentTemplateFamily,
  OwnerDocumentTemplateFamilyDescriptor,
  OwnerDocumentTemplateRegistryEntry,
} from './owner-document-platform.types.js';
import { OWNER_DOCUMENT_TEMPLATE_FAMILIES } from './owner-document-platform.types.js';

const PENDING_NOTE =
  'Registered for Universal Document Platform. Layout seed/widgets activate in a later phase.';

function pendingFamily(
  family: OwnerDocumentTemplateFamily,
  label: string,
): OwnerDocumentTemplateRegistryEntry {
  return {
    template_family: family,
    label,
    status: 'registered_pending',
    default_layout_key: null,
    allowed_document_type_groups: ['all'],
    country_codes: null,
    section_labels: {},
    widget_catalog: [],
    branding_bounds: null,
    country_pack_hooks: {
      may_contribute_widgets: true,
      may_contribute_required_widgets: true,
      may_contribute_labels: true,
    },
    note: PENDING_NOTE,
  };
}

function buildInvoiceRegistryEntry(): OwnerDocumentTemplateRegistryEntry {
  return {
    template_family: INVOICE_TEMPLATE_FAMILY,
    label: 'Invoice',
    status: 'active',
    default_layout_key: 'income_sectioned_il',
    allowed_document_type_groups: ['all', 'tax_group', 'quote_deal', 'receipt', 'credit'],
    country_codes: ['IL'],
    section_labels: { ...INVOICE_SECTION_LABELS },
    widget_catalog: buildInvoiceFamilyWidgetCatalog(),
    branding_bounds: {
      logo_size_keys_allowed: ['small', 'medium', 'large'],
      color_theme_keys_allowed: [
        'nodexpro_premium',
        'black_white',
        'pastel_purple',
        'teal',
        'dark_blue',
        'gray',
        'pale_peach',
        'pale_green',
        'pale_mint',
        'pale_blue',
        'red',
        'bright_blue',
        'green',
        'yellow',
      ],
    },
    country_pack_hooks: {
      may_contribute_widgets: true,
      may_contribute_required_widgets: true,
      may_contribute_labels: true,
    },
    note: 'First active Universal Document Platform family. Uses existing invoice layout v1 + one renderer.',
  };
}

/** Mutable registry bag — Country Pack / modules may register additional families at boot. */
const REGISTRY = new Map<OwnerDocumentTemplateFamily, OwnerDocumentTemplateRegistryEntry>();

function seedDefaultRegistry(): void {
  if (REGISTRY.size > 0) return;
  REGISTRY.set(INVOICE_TEMPLATE_FAMILY, buildInvoiceRegistryEntry());
  REGISTRY.set('receipt', pendingFamily('receipt', 'Receipt'));
  REGISTRY.set('tax_invoice', pendingFamily('tax_invoice', 'Tax Invoice'));
  REGISTRY.set('quote', pendingFamily('quote', 'Quote'));
  REGISTRY.set('credit_note', pendingFamily('credit_note', 'Credit Note'));
  REGISTRY.set('purchase_order', pendingFamily('purchase_order', 'Purchase Order'));
  REGISTRY.set('sales_order', pendingFamily('sales_order', 'Sales Order'));
  REGISTRY.set('payslip', pendingFamily('payslip', 'Payslip'));
  REGISTRY.set('contract', pendingFamily('contract', 'Contract'));
  REGISTRY.set('statement', pendingFamily('statement', 'Statement'));
  REGISTRY.set('reminder', pendingFamily('reminder', 'Reminder'));
  REGISTRY.set('letter', pendingFamily('letter', 'Letter'));
  REGISTRY.set('report', pendingFamily('report', 'Report'));
}

export function listOwnerDocumentTemplateFamilies(): OwnerDocumentTemplateFamilyDescriptor[] {
  seedDefaultRegistry();
  return OWNER_DOCUMENT_TEMPLATE_FAMILIES.map((family) => {
    const entry = REGISTRY.get(family) ?? pendingFamily(family, family);
    return {
      template_family: entry.template_family,
      label: entry.label,
      status: entry.status,
      default_layout_key: entry.default_layout_key,
      allowed_document_type_groups: entry.allowed_document_type_groups,
      country_codes: entry.country_codes,
      note: entry.note,
    };
  });
}

export function getOwnerDocumentTemplateRegistryEntry(
  family: string,
): OwnerDocumentTemplateRegistryEntry | null {
  seedDefaultRegistry();
  const key = String(family ?? '').trim() as OwnerDocumentTemplateFamily;
  return REGISTRY.get(key) ?? null;
}

export function resolveActiveOwnerDocumentTemplateFamily(
  requested: string | null | undefined,
): OwnerDocumentTemplateFamily {
  seedDefaultRegistry();
  const key = String(requested ?? '').trim() as OwnerDocumentTemplateFamily;
  const entry = REGISTRY.get(key);
  if (entry?.status === 'active') return entry.template_family;
  return INVOICE_TEMPLATE_FAMILY;
}

/**
 * Country Pack / module registration hook (foundation).
 * Replaces pending entry when a family becomes active.
 */
export function registerOwnerDocumentTemplateFamily(
  entry: OwnerDocumentTemplateRegistryEntry,
): void {
  seedDefaultRegistry();
  if (!(OWNER_DOCUMENT_TEMPLATE_FAMILIES as readonly string[]).includes(entry.template_family)) {
    throw new Error(`Unknown template_family: ${entry.template_family}`);
  }
  REGISTRY.set(entry.template_family, entry);
}

/** Test helper — reset registry to defaults. */
export function resetOwnerDocumentTemplateRegistryForTests(): void {
  REGISTRY.clear();
  seedDefaultRegistry();
}
