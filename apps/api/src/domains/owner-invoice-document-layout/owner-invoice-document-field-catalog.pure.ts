/**
 * INV-13A — Backend-owned field catalog for Owner Invoice Document Builder.
 * No VAT percentage values — rates live in Country Pack / Owner Legal Control.
 */

import type {
  OwnerInvoiceFieldCatalogEntry,
  OwnerInvoiceLayoutSectionKey,
} from './owner-invoice-document-layout.types.js';

const SECTION = {
  issuer: 'issuer_branding' as const,
  doc: 'document_identity' as const,
  customer: 'customer' as const,
  lines: 'lines' as const,
  totals: 'totals' as const,
  notes: 'notes' as const,
  payments: 'payments' as const,
  legal: 'legal_footer' as const,
};

function entry(
  partial: OwnerInvoiceFieldCatalogEntry,
): OwnerInvoiceFieldCatalogEntry {
  return partial;
}

export const OWNER_INVOICE_DOCUMENT_FIELD_CATALOG: OwnerInvoiceFieldCatalogEntry[] = [
  entry({
    field_key: 'logo',
    group: 'issuer',
    label: 'לוגו',
    requiredness: 'optional',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: true,
  }),
  entry({
    field_key: 'issuer_name',
    group: 'issuer',
    label: 'שם מנפיק',
    requiredness: 'required',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'tax_id',
    group: 'issuer',
    label: 'ח.פ. / עוסק מורשה',
    requiredness: 'legal_required',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'address',
    group: 'issuer',
    label: 'כתובת',
    requiredness: 'optional',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'city',
    group: 'issuer',
    label: 'עיר',
    requiredness: 'optional',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'phone',
    group: 'issuer',
    label: 'טלפון',
    requiredness: 'optional',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'email',
    group: 'issuer',
    label: 'דוא״ל',
    requiredness: 'optional',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'website',
    group: 'issuer',
    label: 'אתר',
    requiredness: 'optional',
    allowed_sections: [SECTION.issuer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'document_type',
    group: 'document',
    label: 'סוג מסמך',
    requiredness: 'required',
    allowed_sections: [SECTION.doc],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'document_number',
    group: 'document',
    label: 'מספר מסמך',
    requiredness: 'legal_required',
    allowed_sections: [SECTION.doc],
    display_variants: ['number_bar'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'issue_date',
    group: 'document',
    label: 'תאריך הפקה',
    requiredness: 'legal_required',
    allowed_sections: [SECTION.doc],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'due_date',
    group: 'document',
    label: 'תאריך לתשלום',
    requiredness: 'optional',
    allowed_sections: [SECTION.doc],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'tax_allocation_number',
    group: 'document',
    label: 'מספר הקצאה',
    requiredness: 'country_required',
    allowed_sections: [SECTION.doc],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'payment_terms',
    group: 'document',
    label: 'תנאי תשלום',
    requiredness: 'optional',
    allowed_sections: [SECTION.doc],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'customer_name',
    group: 'customer',
    label: 'שם לקוח',
    requiredness: 'required',
    allowed_sections: [SECTION.customer],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'customer_tax_id',
    group: 'customer',
    label: 'מס׳ עוסק לקוח',
    requiredness: 'optional',
    allowed_sections: [SECTION.customer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'customer_address',
    group: 'customer',
    label: 'כתובת לקוח',
    requiredness: 'optional',
    allowed_sections: [SECTION.customer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'customer_email',
    group: 'customer',
    label: 'דוא״ל לקוח',
    requiredness: 'optional',
    allowed_sections: [SECTION.customer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'customer_phone',
    group: 'customer',
    label: 'טלפון לקוח',
    requiredness: 'optional',
    allowed_sections: [SECTION.customer],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'line_description',
    group: 'lines',
    label: 'פירוט',
    requiredness: 'required',
    allowed_sections: [SECTION.lines],
    display_variants: ['table_column'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'line_quantity',
    group: 'lines',
    label: 'כמות',
    requiredness: 'required',
    allowed_sections: [SECTION.lines],
    display_variants: ['table_column'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'line_unit_price',
    group: 'lines',
    label: 'מחיר ליח׳',
    requiredness: 'required',
    allowed_sections: [SECTION.lines],
    display_variants: ['table_column'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'line_currency',
    group: 'lines',
    label: 'מטבע',
    requiredness: 'optional',
    allowed_sections: [SECTION.lines],
    display_variants: ['table_column'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'line_vat',
    group: 'lines',
    label: 'מע״מ (שדה תצוגה)',
    requiredness: 'legal_required',
    allowed_sections: [SECTION.lines],
    display_variants: ['table_column'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'line_total',
    group: 'lines',
    label: 'סה״כ שורה',
    requiredness: 'required',
    allowed_sections: [SECTION.lines],
    display_variants: ['table_column'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'subtotal',
    group: 'totals',
    label: 'סכום ביניים',
    requiredness: 'required',
    allowed_sections: [SECTION.totals],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'vat_total',
    group: 'totals',
    label: 'מע״מ כולל (שדה תצוגה)',
    requiredness: 'legal_required',
    allowed_sections: [SECTION.totals],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'grand_total',
    group: 'totals',
    label: 'סה״כ לתשלום',
    requiredness: 'required',
    allowed_sections: [SECTION.totals],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'notes',
    group: 'legal',
    label: 'הערות',
    requiredness: 'optional',
    allowed_sections: [SECTION.notes, SECTION.legal],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'signature_block',
    group: 'legal',
    label: 'חתימה',
    requiredness: 'optional',
    allowed_sections: [SECTION.legal, SECTION.payments],
    display_variants: ['default'],
    move_allowed: true,
    hide_allowed: true,
  }),
  entry({
    field_key: 'legal_wording',
    group: 'legal',
    label: 'נוסח משפטי',
    requiredness: 'legal_required',
    allowed_sections: [SECTION.legal],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: false,
  }),
  entry({
    field_key: 'platform_footer',
    group: 'legal',
    label: 'כותרת תחתית פלטפורמה',
    requiredness: 'optional',
    allowed_sections: [SECTION.legal],
    display_variants: ['default'],
    move_allowed: false,
    hide_allowed: true,
  }),
];

const FORBIDDEN_LAYOUT_VALUE_KEYS = [
  'vat_rate',
  'vat_percent',
  'vat_percentage',
  'effective_vat_rate',
  'legal_vat_rate',
] as const;

export function getOwnerInvoiceFieldCatalog(): OwnerInvoiceFieldCatalogEntry[] {
  return OWNER_INVOICE_DOCUMENT_FIELD_CATALOG.map((e) => ({ ...e }));
}

export function findOwnerInvoiceFieldCatalogEntry(
  fieldKey: string,
): OwnerInvoiceFieldCatalogEntry | null {
  const key = String(fieldKey ?? '').trim();
  return OWNER_INVOICE_DOCUMENT_FIELD_CATALOG.find((e) => e.field_key === key) ?? null;
}

export function isOwnerInvoiceCatalogFieldKey(fieldKey: string): boolean {
  return findOwnerInvoiceFieldCatalogEntry(fieldKey) != null;
}

export function assertSectionAllowedForField(
  fieldKey: string,
  sectionKey: OwnerInvoiceLayoutSectionKey,
): void {
  const entry = findOwnerInvoiceFieldCatalogEntry(fieldKey);
  if (!entry) throw new Error(`Unknown field_key: ${fieldKey}`);
  if (!entry.allowed_sections.includes(sectionKey)) {
    throw new Error(`Field ${fieldKey} not allowed in section ${sectionKey}`);
  }
}

export function fieldHideRejectedReason(fieldKey: string): string | null {
  const entry = findOwnerInvoiceFieldCatalogEntry(fieldKey);
  if (!entry) return `Unknown field_key: ${fieldKey}`;
  if (!entry.hide_allowed) {
    return `Field ${fieldKey} is ${entry.requiredness} and cannot be hidden`;
  }
  if (
    entry.requiredness === 'required' ||
    entry.requiredness === 'legal_required' ||
    entry.requiredness === 'country_required'
  ) {
    return `Field ${fieldKey} is ${entry.requiredness} and cannot be hidden`;
  }
  return null;
}

/** Reject VAT rate / legal rate smuggling into layout JSON. */
export function layoutJsonContainsForbiddenVatRateKeys(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (FORBIDDEN_LAYOUT_VALUE_KEYS.some((f) => key === f || key.includes(f))) {
        return true;
      }
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return false;
}
