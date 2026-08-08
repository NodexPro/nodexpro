/**
 * INV-13C — Universal Document Platform aggregate slice (pure).
 * Attached to Owner builder aggregate; FE renders only from this metadata.
 */

import type { OwnerInvoiceLayoutDefinitionV1 } from '../owner-invoice-document-layout/owner-invoice-document-layout.types.js';
import {
  buildInvoiceFamilySectionModel,
  buildInvoiceWidgetCatalogGroups,
  INVOICE_TEMPLATE_FAMILY,
} from './owner-document-invoice-family.adapter.pure.js';
import {
  getOwnerDocumentTemplateRegistryEntry,
  listOwnerDocumentTemplateFamilies,
  resolveActiveOwnerDocumentTemplateFamily,
} from './owner-document-template-registry.pure.js';
import { OWNER_DOCUMENT_PLATFORM_AGGREGATE_KEY } from './owner-document-platform.types.js';

export function buildOwnerDocumentPlatformAggregateSlice(params: {
  template_family?: string | null;
  definition: OwnerInvoiceLayoutDefinitionV1;
}): Record<string, unknown> {
  const template_family = resolveActiveOwnerDocumentTemplateFamily(params.template_family);
  const registry = getOwnerDocumentTemplateRegistryEntry(template_family);
  const families = listOwnerDocumentTemplateFamilies();

  if (!registry || registry.status !== 'active') {
    // Fallback to invoice active family if requested family is pending.
    const invoice = getOwnerDocumentTemplateRegistryEntry(INVOICE_TEMPLATE_FAMILY)!;
    const section_model = buildInvoiceFamilySectionModel(
      params.definition,
      invoice.section_labels,
    );
    return {
      platform_aggregate_key: OWNER_DOCUMENT_PLATFORM_AGGREGATE_KEY,
      template_family: INVOICE_TEMPLATE_FAMILY,
      template_family_status: 'active',
      document_template_families: families,
      selected_template_family: families.find((f) => f.template_family === INVOICE_TEMPLATE_FAMILY),
      widget_catalog: invoice.widget_catalog,
      widget_catalog_groups: buildInvoiceWidgetCatalogGroups(invoice.widget_catalog),
      section_model,
      section_labels: invoice.section_labels,
      country_pack_hooks: invoice.country_pack_hooks,
      universal_pipeline: {
        builder: 'layout_definition_json',
        renderer: 'unified_income_document_renderer',
        outputs: ['preview_html', 'pdf'],
        note: 'One renderer for all template families. No per-type renderer forks.',
      },
      requested_template_family: template_family,
      requested_template_pending: true,
      note:
        'Requested template family is registered but not yet active. Showing Invoice foundation.',
    };
  }

  const section_model = buildInvoiceFamilySectionModel(
    params.definition,
    registry.section_labels,
  );

  return {
    platform_aggregate_key: OWNER_DOCUMENT_PLATFORM_AGGREGATE_KEY,
    template_family: registry.template_family,
    template_family_status: registry.status,
    document_template_families: families,
    selected_template_family: families.find((f) => f.template_family === registry.template_family),
    widget_catalog: registry.widget_catalog,
    widget_catalog_groups: buildInvoiceWidgetCatalogGroups(registry.widget_catalog),
    section_model,
    section_labels: registry.section_labels,
    country_pack_hooks: registry.country_pack_hooks,
    universal_pipeline: {
      builder: 'layout_definition_json',
      renderer: 'unified_income_document_renderer',
      outputs: ['preview_html', 'pdf'],
      note: 'One renderer for all template families. No per-type renderer forks.',
    },
    requested_template_family: template_family,
    requested_template_pending: false,
    note: registry.note,
  };
}
