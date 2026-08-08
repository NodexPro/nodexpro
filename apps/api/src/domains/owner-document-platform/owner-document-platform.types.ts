/**
 * INV-13C — Universal Document Platform types (Owner Builder foundation).
 * Invoice is the first template family; other families register into the same model.
 */

export const OWNER_DOCUMENT_PLATFORM_AGGREGATE_KEY =
  'owner_document_platform_builder_aggregate' as const;

/** Canonical template families — registry may enable a subset. */
export const OWNER_DOCUMENT_TEMPLATE_FAMILIES = [
  'invoice',
  'receipt',
  'tax_invoice',
  'quote',
  'credit_note',
  'purchase_order',
  'sales_order',
  'payslip',
  'contract',
  'statement',
  'reminder',
  'letter',
  'report',
] as const;

export type OwnerDocumentTemplateFamily = (typeof OWNER_DOCUMENT_TEMPLATE_FAMILIES)[number];

export const OWNER_DOCUMENT_WIDGET_TYPES = [
  'text',
  'image',
  'logo',
  'table',
  'signature',
  'divider',
  'barcode',
  'qr_code',
  'legal_block',
  'payment_block',
  'totals_block',
  'address_block',
  'contact_block',
  'timeline',
  'chart',
  'custom_label',
] as const;

export type OwnerDocumentWidgetType = (typeof OWNER_DOCUMENT_WIDGET_TYPES)[number];

export type OwnerDocumentWidgetFieldMeta = {
  field_key: string;
  label: string;
  requiredness: 'optional' | 'required' | 'legal_required' | 'country_required';
  display_variants: string[];
  move_allowed: boolean;
  hide_allowed: boolean;
};

export type OwnerDocumentWidgetCatalogEntry = {
  widget_key: string;
  widget_type: OwnerDocumentWidgetType;
  label: string;
  group_key: string;
  group_label: string;
  allowed_section_keys: string[];
  fields: OwnerDocumentWidgetFieldMeta[];
  /** Compatibility: primary field_key when widget maps 1:1 to a layout field. */
  primary_field_key: string | null;
};

export type OwnerDocumentSectionModel = {
  section_key: string;
  label: string;
  type: 'upper' | 'body' | 'lower' | 'custom';
  allowed_widget_keys: string[];
  constraints: {
    min_height_px: number;
    max_height_px: number;
    col_start: number;
    col_span: number;
    resize_allowed: boolean;
    reorder_allowed: boolean;
    move_allowed: boolean;
    owner_locked: boolean;
  };
  order: number;
  visible: boolean;
};

export type OwnerDocumentTemplateFamilyDescriptor = {
  template_family: OwnerDocumentTemplateFamily;
  label: string;
  status: 'active' | 'registered_pending' | 'disabled';
  default_layout_key: string | null;
  allowed_document_type_groups: string[];
  country_codes: string[] | null;
  note: string | null;
};

export type OwnerDocumentTemplateRegistryEntry = {
  template_family: OwnerDocumentTemplateFamily;
  label: string;
  status: 'active' | 'registered_pending' | 'disabled';
  default_layout_key: string | null;
  allowed_document_type_groups: string[];
  country_codes: string[] | null;
  section_labels: Record<string, string>;
  widget_catalog: OwnerDocumentWidgetCatalogEntry[];
  branding_bounds: {
    logo_size_keys_allowed: string[];
    color_theme_keys_allowed: string[];
  } | null;
  country_pack_hooks: {
    may_contribute_widgets: boolean;
    may_contribute_required_widgets: boolean;
    may_contribute_labels: boolean;
  };
  note: string | null;
};
