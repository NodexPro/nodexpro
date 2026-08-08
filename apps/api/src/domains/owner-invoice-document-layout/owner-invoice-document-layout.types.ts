/**
 * INV-13A — Owner Invoice Document Builder types (Phase 1).
 */

export const OWNER_INVOICE_LAYOUT_AGGREGATE_KEY =
  'owner_invoice_document_builder_aggregate' as const;

export const OWNER_INVOICE_LAYOUT_KEY_DEFAULT = 'income_sectioned_il' as const;

export const OWNER_INVOICE_LAYOUT_STATUSES = ['draft', 'published', 'archived'] as const;
export type OwnerInvoiceLayoutStatus = (typeof OWNER_INVOICE_LAYOUT_STATUSES)[number];

export const OWNER_INVOICE_LAYOUT_DOCUMENT_TYPE_GROUPS = [
  'all',
  'tax_group',
  'quote_deal',
  'receipt',
  'credit',
] as const;
export type OwnerInvoiceLayoutDocumentTypeGroup =
  (typeof OWNER_INVOICE_LAYOUT_DOCUMENT_TYPE_GROUPS)[number];

export const OWNER_INVOICE_LAYOUT_COMMANDS = {
  create_draft: 'create_owner_invoice_layout_draft',
  move_section: 'move_owner_invoice_layout_section',
  resize_section: 'resize_owner_invoice_layout_section',
  move_field: 'move_owner_invoice_layout_field',
  place_field: 'place_owner_invoice_layout_field',
  set_field_visibility: 'set_owner_invoice_field_visibility',
  set_table_column: 'set_owner_invoice_table_column',
  set_section_lock: 'set_owner_invoice_section_lock',
  publish: 'publish_owner_invoice_layout_version',
  archive: 'archive_owner_invoice_layout_version',
} as const;

export type OwnerInvoiceLayoutCommand =
  (typeof OWNER_INVOICE_LAYOUT_COMMANDS)[keyof typeof OWNER_INVOICE_LAYOUT_COMMANDS];

const OWNER_INVOICE_LAYOUT_COMMAND_SET = new Set<string>(Object.values(OWNER_INVOICE_LAYOUT_COMMANDS));

export function isOwnerInvoiceLayoutCommand(command: string): command is OwnerInvoiceLayoutCommand {
  return OWNER_INVOICE_LAYOUT_COMMAND_SET.has(command);
}

export type OwnerInvoiceLayoutFieldRequiredness =
  | 'optional'
  | 'required'
  | 'legal_required'
  | 'country_required';

export type OwnerInvoiceLayoutSectionKey =
  | 'issuer_branding'
  | 'document_identity'
  | 'customer'
  | 'lines'
  | 'totals'
  | 'notes'
  | 'payments'
  | 'legal_footer';

export type OwnerInvoiceLayoutDefinitionV1 = {
  schema_version: 1;
  grid: {
    columns: 12;
    page: { width_px: number; height_px: number };
    snap_px: number;
  };
  sections: OwnerInvoiceLayoutSection[];
  fields: OwnerInvoiceLayoutFieldPlacement[];
  table: {
    columns: OwnerInvoiceLayoutTableColumn[];
  };
  user_branding_bounds: {
    logo_size_keys_allowed: string[];
    color_theme_keys_allowed: string[];
  };
};

export type OwnerInvoiceLayoutSection = {
  key: OwnerInvoiceLayoutSectionKey;
  order: number;
  zone: 'upper' | 'body' | 'lower';
  col_start: number;
  col_span: number;
  min_height_px: number;
  max_height_px: number;
  height_px: number;
  alignment: 'start' | 'center' | 'end' | 'stretch';
  visible: boolean;
  owner_locked: boolean;
};

export type OwnerInvoiceLayoutFieldPlacement = {
  field_key: string;
  section_key: OwnerInvoiceLayoutSectionKey;
  order: number;
  visible: boolean;
  width_span: number;
  display_variant: string;
  owner_locked: boolean;
};

export type OwnerInvoiceLayoutTableColumn = {
  key: string;
  order: number;
  visible: boolean;
  width_px: number | null;
  align: 'start' | 'center' | 'end';
  owner_locked: boolean;
};

export type OwnerInvoiceLayoutVersionRow = {
  id: string;
  layout_key: string;
  version_number: number;
  document_type_group: OwnerInvoiceLayoutDocumentTypeGroup;
  country_code: string | null;
  status: OwnerInvoiceLayoutStatus;
  layout_definition_json: OwnerInvoiceLayoutDefinitionV1;
  based_on_version_id: string | null;
  published_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OwnerInvoiceFieldCatalogEntry = {
  field_key: string;
  group: 'issuer' | 'document' | 'customer' | 'lines' | 'totals' | 'legal';
  label: string;
  requiredness: OwnerInvoiceLayoutFieldRequiredness;
  allowed_sections: OwnerInvoiceLayoutSectionKey[];
  display_variants: string[];
  move_allowed: boolean;
  hide_allowed: boolean;
};
