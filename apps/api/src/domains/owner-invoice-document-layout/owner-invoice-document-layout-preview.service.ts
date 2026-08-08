/**
 * INV-13A — Owner builder preview via existing unified renderer (no second renderer).
 */

import { renderStudioSamplePreviewHtml } from '../income/income-document-branding-preview.renderer.js';
import {
  DEFAULT_DISPLAY_OPTIONS,
  resolveBrandingProfile,
} from '../income/income-document-branding.pure.js';
import type { IncomeBrandingResolvedProfile } from '../income/income-document-branding.types.js';
import { adaptOwnerLayoutDefinitionForCanonicalRenderer } from './owner-invoice-document-layout-resolver.pure.js';
import type { OwnerInvoiceLayoutDefinitionV1 } from './owner-invoice-document-layout.types.js';

function sampleBrandingForOwnerPreview(
  definition: OwnerInvoiceLayoutDefinitionV1,
): IncomeBrandingResolvedProfile {
  const bounds = definition.user_branding_bounds;
  const logoSize =
    bounds.logo_size_keys_allowed.includes('medium')
      ? 'medium'
      : bounds.logo_size_keys_allowed[0] ?? 'medium';
  const theme =
    bounds.color_theme_keys_allowed.includes('nodexpro_premium')
      ? 'nodexpro_premium'
      : bounds.color_theme_keys_allowed[0] ?? 'nodexpro_premium';

  const adapted = adaptOwnerLayoutDefinitionForCanonicalRenderer(definition);
  return resolveBrandingProfile(
    {
      id: '00000000-0000-4000-8000-000000000001',
      organization_id: '00000000-0000-4000-8000-000000000002',
      issuer_business_id: '00000000-0000-4000-8000-000000000003',
      represented_client_id: null,
      document_style_key: adapted.document_style_key,
      color_theme_key: theme,
      layout_template_key: null,
      logo_size_key: logoSize,
      logo_file_asset_id: null,
      signature_file_asset_id: null,
      company_subtitle: 'דוגמה — תצוגת בעלים',
      primary_color: '',
      secondary_color: '',
      table_header_color: '',
      totals_color: '',
      client_block_position: 'right',
      footer_text: null,
      bank_name: 'בנק לדוגמה',
      bank_branch: '001',
      bank_account: '123456',
      swift: null,
      iban: null,
      payment_instructions: null,
      email_subject_template: null,
      email_body_template: null,
      customer_notes: null,
      terms_and_conditions: null,
      display_options: {
        ...DEFAULT_DISPLAY_OPTIONS,
        show_logo: adapted.field_visibility.logo !== false,
        show_signature: adapted.field_visibility.signature_block !== false,
        show_footer: adapted.field_visibility.platform_footer !== false,
        show_notes: adapted.field_visibility.notes !== false,
        show_vat_row: adapted.field_visibility.vat_total !== false,
        show_due_date: adapted.field_visibility.due_date !== false,
        show_payment_terms: adapted.field_visibility.payment_terms !== false,
        show_item_index: adapted.table_column_visibility.index !== false,
        show_currency: adapted.table_column_visibility.line_currency !== false,
      },
      payment_methods: [],
      document_attachments: null,
      default_payment_terms: null,
      document_type_style_overrides: null,
    },
    { logo_data_url: null, signature_data_url: null },
  );
}

export function buildOwnerInvoiceLayoutPreviewHtml(
  definition: OwnerInvoiceLayoutDefinitionV1,
): string {
  // Ensures adapter is exercised for layout-aware preview (sectioned + visibility).
  adaptOwnerLayoutDefinitionForCanonicalRenderer(definition);
  const branding = sampleBrandingForOwnerPreview(definition);
  return renderStudioSamplePreviewHtml(branding, 'חשבונית מס');
}
