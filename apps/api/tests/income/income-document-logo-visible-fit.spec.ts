import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgba, encodeRgbaPng } from '../../src/domains/income/income-document-logo-png.pure.js';
import {
  computeLargestSafeLogoFitScale,
  findVisibleLogoBounds,
  LOGO_FRAME_PADDING_RATIO,
  logoCssFitPercent,
  prepareLogoDataUrlForDocumentRender,
  prepareLogoDataUrlForDocumentRenderDetailed,
  trimTransparentMarginsFromPngBuffer,
} from '../../src/domains/income/income-document-logo-visible-fit.pure.js';
import { SECTIONED_LOGO_FRAME } from '../../src/domains/income/income-document-sectioned-logo-frame.pure.js';
import {
  renderIncomeBrandedPreviewHtml,
  renderStudioSamplePreviewHtml,
} from '../../src/domains/income/income-document-branding-preview.renderer.js';
import { resolveBrandingProfile } from '../../src/domains/income/income-document-branding.pure.js';
import { renderUnifiedIncomeDocumentHtml } from '../../src/domains/income/income-document-unified-render.html.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';
import type { UnifiedIncomeDocumentRenderInput } from '../../src/domains/income/income-document-unified-render.pure.js';

function solidRgba(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = rgba[0];
    out[i * 4 + 1] = rgba[1];
    out[i * 4 + 2] = rgba[2];
    out[i * 4 + 3] = rgba[3];
  }
  return out;
}

/** Opaque 20×10 mark centered in a 100×60 transparent canvas. */
function paddedLogoPng(): Buffer {
  const canvasW = 100;
  const canvasH = 60;
  const markW = 20;
  const markH = 10;
  const ox = 40;
  const oy = 25;
  const rgba = solidRgba(canvasW, canvasH, [0, 0, 0, 0]);
  for (let y = 0; y < markH; y += 1) {
    for (let x = 0; x < markW; x += 1) {
      const i = ((oy + y) * canvasW + (ox + x)) * 4;
      rgba[i] = 91;
      rgba[i + 1] = 33;
      rgba[i + 2] = 182;
      rgba[i + 3] = 255;
    }
  }
  return encodeRgbaPng(rgba, canvasW, canvasH);
}

/** Full-bleed opaque logo — no transparent margins. */
function tightLogoPng(): Buffer {
  return encodeRgbaPng(solidRgba(40, 20, [91, 33, 182, 255]), 40, 20);
}

function sectionedRow(): IncomeBrandingProfileRow {
  return {
    id: 'p1',
    organization_id: 'o1',
    issuer_business_id: 'b1',
    represented_client_id: null,
    logo_file_asset_id: null,
    signature_file_asset_id: null,
    company_subtitle: null,
    document_style_key: 'sectioned',
    color_theme_key: 'nodexpro_premium',
    primary_color: '#5b21b6',
    secondary_color: '#ddd6fe',
    table_header_color: '#5b21b6',
    totals_color: '#5b21b6',
    client_block_position: 'right',
    footer_text: null,
    bank_name: null,
    bank_branch: null,
    bank_account: null,
    swift: null,
    iban: null,
    payment_instructions: null,
    email_subject_template: null,
    email_body_template: null,
    customer_notes: null,
    terms_and_conditions: null,
    display_options: { show_logo: true },
    payment_methods: [],
    document_attachments: [],
    default_payment_terms: null,
  };
}

function extractLogoSrc(html: string): string | null {
  return html.match(/class="nx-doc__logo-img" src="(data:image\/[^"]+)"/)?.[1] ?? null;
}

describe('logo visible-content fit', () => {
  test('PNG with large transparent margins is cropped to smaller dimensions', () => {
    const png = paddedLogoPng();
    const decoded = decodePngToRgba(png)!;
    assert.equal(decoded.width, 100);
    assert.equal(decoded.height, 60);
    const bounds = findVisibleLogoBounds(decoded.data, decoded.width, decoded.height)!;
    assert.equal(bounds.width, 20);
    assert.equal(bounds.height, 10);
    assert.ok(bounds.width < decoded.width);
    assert.ok(bounds.height < decoded.height);

    const trimmed = trimTransparentMarginsFromPngBuffer(png)!;
    assert.equal(trimmed.bounds.width, 20);
    assert.equal(trimmed.bounds.height, 10);
    assert.ok(trimmed.bounds.width < trimmed.source_width);
    assert.ok(trimmed.bounds.height < trimmed.source_height);
  });

  test('prepareLogoDataUrlForDocumentRender returns cropped data URL for padded PNG', () => {
    const raw = `data:image/png;base64,${paddedLogoPng().toString('base64')}`;
    const diag = prepareLogoDataUrlForDocumentRenderDetailed(raw);
    assert.equal(diag.prepare_called, true);
    assert.equal(diag.trim_status, 'applied');
    assert.equal(diag.src_changed, true);
    assert.equal(diag.final_src_is_cropped, true);
    assert.equal(diag.original_width, 100);
    assert.equal(diag.original_height, 60);
    assert.equal(diag.cropped_width, 20);
    assert.equal(diag.cropped_height, 10);
    assert.ok((diag.cropped_width ?? 0) < (diag.original_width ?? 0));
    assert.ok((diag.cropped_height ?? 0) < (diag.original_height ?? 0));
    assert.notEqual(diag.data_url, raw);
    assert.match(diag.data_url!, /^data:image\/png;base64,/);
    assert.equal(prepareLogoDataUrlForDocumentRender(raw), diag.data_url);
  });

  test('renderer receives cropped data URL as final img src (not original)', () => {
    const original = `data:image/png;base64,${paddedLogoPng().toString('base64')}`;
    const processed = prepareLogoDataUrlForDocumentRenderDetailed(original).data_url!;
    const html = renderIncomeBrandedPreviewHtml({
      branding: resolveBrandingProfile(sectionedRow(), {
        logo_data_url: original,
        signature_data_url: null,
      }),
      docTypeLabel: 'חשבונית מס',
      document_type: 'tax_invoice',
      numberPreview: '4000',
      issuer: { display_name: 'Biz', tax_id: '1', address: 'A', phone: '2', email: 'a@b.c' },
      recipient: { display_name: 'Client', tax_id: '9', address: 'B', phone: '3', email: 'c@d.e' },
      document_date: '2026-05-01',
      due_date: null,
      currency: 'ILS',
      lineRows: [],
      totals: {
        subtotal_before_discount: '100',
        discount: null,
        subtotal_after_discount: '100',
        vat_label: 'מע״מ',
        vat: '17',
        grand_total: '117',
      },
      notes: null,
      company_subtitle: null,
    });
    const finalSrc = extractLogoSrc(html);
    assert.ok(finalSrc);
    assert.equal(finalSrc, processed);
    assert.notEqual(finalSrc, original);
    assert.match(html, /data-logo-processing="cropped"/);
  });

  test('Branding Studio preview and document preview use the same logo-processing path', () => {
    const original = `data:image/png;base64,${paddedLogoPng().toString('base64')}`;
    const branding = resolveBrandingProfile(sectionedRow(), {
      logo_data_url: original,
      signature_data_url: null,
    });
    const studioHtml = renderStudioSamplePreviewHtml(branding, 'הצעת מחיר');
    const documentInput: UnifiedIncomeDocumentRenderInput = {
      branding,
      docTypeLabel: 'חשבונית מס',
      numberPreview: '4000',
      document_type: 'tax_invoice',
      issuer: { display_name: 'Biz', tax_id: '1', address: 'A', phone: '2', email: 'a@b.c' },
      recipient: { display_name: 'Client', tax_id: '9', address: 'B', phone: '3', email: 'c@d.e' },
      document_date: '2026-05-01',
      due_date: null,
      currency: 'ILS',
      lineRows: [],
      totals: {
        subtotal_before_discount: '100',
        discount: null,
        subtotal_after_discount: '100',
        vat_label: 'מע״מ',
        vat: '17',
        grand_total: '117',
      },
      notes: null,
      company_subtitle: null,
    };
    const documentHtml = renderUnifiedIncomeDocumentHtml(documentInput);
    const studioSrc = extractLogoSrc(studioHtml);
    const documentSrc = extractLogoSrc(documentHtml);
    const processed = prepareLogoDataUrlForDocumentRender(original);
    assert.equal(studioSrc, processed);
    assert.equal(documentSrc, processed);
    assert.equal(studioSrc, documentSrc);
    assert.match(studioHtml, /data-logo-processing="cropped"/);
    assert.match(documentHtml, /data-logo-processing="cropped"/);
  });

  test('normal PNG without large transparent margins still renders correctly', () => {
    const original = `data:image/png;base64,${tightLogoPng().toString('base64')}`;
    const diag = prepareLogoDataUrlForDocumentRenderDetailed(original);
    assert.equal(diag.trim_status, 'skipped_no_margin');
    assert.equal(diag.src_changed, false);
    assert.equal(diag.data_url, original);
    const html = renderIncomeBrandedPreviewHtml({
      branding: resolveBrandingProfile(sectionedRow(), {
        logo_data_url: original,
        signature_data_url: null,
      }),
      docTypeLabel: 'חשבונית מס',
      document_type: 'tax_invoice',
      numberPreview: '4000',
      issuer: { display_name: 'Biz', tax_id: '1', address: 'A', phone: '2', email: 'a@b.c' },
      recipient: { display_name: 'Client', tax_id: '9', address: 'B', phone: '3', email: 'c@d.e' },
      document_date: '2026-05-01',
      due_date: null,
      currency: 'ILS',
      lineRows: [],
      totals: {
        subtotal_before_discount: '100',
        discount: null,
        subtotal_after_discount: '100',
        vat_label: 'מע״מ',
        vat: '17',
        grand_total: '117',
      },
      notes: null,
      company_subtitle: null,
    });
    assert.equal(extractLogoSrc(html), original);
    assert.match(html, /data-logo-processing="original"/);
  });

  test('JPEG and WebP pass-through behavior remains unchanged', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQ';
    const webp = 'data:image/webp;base64,UklGR';
    const jpegDiag = prepareLogoDataUrlForDocumentRenderDetailed(jpeg);
    const webpDiag = prepareLogoDataUrlForDocumentRenderDetailed(webp);
    assert.equal(jpegDiag.trim_status, 'skipped_opaque_format');
    assert.equal(webpDiag.trim_status, 'skipped_opaque_format');
    assert.equal(jpegDiag.data_url, jpeg);
    assert.equal(webpDiag.data_url, webp);
    assert.equal(prepareLogoDataUrlForDocumentRender(jpeg), jpeg);
    assert.equal(prepareLogoDataUrlForDocumentRender(webp), webp);
  });

  test('computeLargestSafeLogoFitScale uses frame and 4% padding', () => {
    const scale = computeLargestSafeLogoFitScale({
      content_width_px: 20,
      content_height_px: 10,
      frame_width_px: SECTIONED_LOGO_FRAME.width_px,
      frame_height_px: SECTIONED_LOGO_FRAME.height_px,
      padding_ratio: LOGO_FRAME_PADDING_RATIO,
    });
    const expected = Math.min(
      (SECTIONED_LOGO_FRAME.width_px * 0.92) / 20,
      (SECTIONED_LOGO_FRAME.height_px * 0.92) / 10,
    );
    assert.ok(Math.abs(scale - expected) < 1e-9);
    assert.equal(logoCssFitPercent(), '92%');
  });

  test('repo NodexPro PNG: crop changes bitmap and reaches final img src', () => {
    const logoPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../web/src/templates/template-1/assets/nodexpro-logo.png',
    );
    let buf: Buffer;
    try {
      buf = readFileSync(logoPath);
    } catch {
      return; // asset absent in some CI layouts
    }
    const original = `data:image/png;base64,${buf.toString('base64')}`;
    const diag = prepareLogoDataUrlForDocumentRenderDetailed(original);
    assert.equal(diag.original_width, 1288);
    assert.equal(diag.original_height, 244);
    assert.ok((diag.original_width ?? 0) / (diag.original_height ?? 1) > 5);
    assert.equal(diag.trim_status, 'applied');
    assert.ok((diag.original_width ?? 0) > (diag.cropped_width ?? 0));
    assert.ok((diag.original_height ?? 0) > (diag.cropped_height ?? 0));
    const html = renderIncomeBrandedPreviewHtml({
      branding: resolveBrandingProfile(sectionedRow(), {
        logo_data_url: original,
        signature_data_url: null,
      }),
      docTypeLabel: 'חשבונית מס',
      document_type: 'tax_invoice',
      numberPreview: '4000',
      issuer: { display_name: 'Biz', tax_id: '1', address: 'A', phone: '2', email: 'a@b.c' },
      recipient: { display_name: 'Client', tax_id: '9', address: 'B', phone: '3', email: 'c@d.e' },
      document_date: '2026-05-01',
      due_date: null,
      currency: 'ILS',
      lineRows: [],
      totals: {
        subtotal_before_discount: '100',
        discount: null,
        subtotal_after_discount: '100',
        vat_label: 'מע״מ',
        vat: '17',
        grand_total: '117',
      },
      notes: null,
      company_subtitle: null,
    });
    assert.equal(extractLogoSrc(html), diag.data_url);
    assert.notEqual(extractLogoSrc(html), original);
    assert.match(html, /data-logo-processing="cropped"/);
  });
});
