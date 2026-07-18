import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decodePngToRgba, encodeRgbaPng } from '../../src/domains/income/income-document-logo-png.pure.js';
import {
  computeLargestSafeLogoFitScale,
  findVisibleLogoBounds,
  LOGO_FRAME_PADDING_RATIO,
  logoCssFitPercent,
  prepareLogoDataUrlForDocumentRender,
  trimTransparentMarginsFromPngBuffer,
} from '../../src/domains/income/income-document-logo-visible-fit.pure.js';
import { SECTIONED_LOGO_FRAME } from '../../src/domains/income/income-document-sectioned-logo-frame.pure.js';
import { renderIncomeBrandedPreviewHtml } from '../../src/domains/income/income-document-branding-preview.renderer.js';
import { resolveBrandingProfile } from '../../src/domains/income/income-document-branding.pure.js';
import type { IncomeBrandingProfileRow } from '../../src/domains/income/income-document-branding.types.js';

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

describe('logo visible-content fit', () => {
  test('findVisibleLogoBounds ignores transparent margins', () => {
    const decoded = decodePngToRgba(paddedLogoPng())!;
    const bounds = findVisibleLogoBounds(decoded.data, decoded.width, decoded.height)!;
    assert.equal(bounds.width, 20);
    assert.equal(bounds.height, 10);
    assert.equal(bounds.minX, 40);
    assert.equal(bounds.minY, 25);
  });

  test('trimTransparentMarginsFromPngBuffer crops to visible content', () => {
    const trimmed = trimTransparentMarginsFromPngBuffer(paddedLogoPng())!;
    assert.equal(trimmed.bounds.width, 20);
    assert.equal(trimmed.bounds.height, 10);
    assert.equal(trimmed.source_width, 100);
    assert.equal(trimmed.source_height, 60);
    const again = trimTransparentMarginsFromPngBuffer(trimmed.buffer);
    assert.equal(again, null);
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

  test('prepareLogoDataUrlForDocumentRender returns cropped PNG data URL', () => {
    const raw = `data:image/png;base64,${paddedLogoPng().toString('base64')}`;
    const prepared = prepareLogoDataUrlForDocumentRender(raw)!;
    assert.match(prepared, /^data:image\/png;base64,/);
    assert.notEqual(prepared, raw);
    const second = prepareLogoDataUrlForDocumentRender(prepared);
    assert.equal(second, prepared);
  });

  test('JPEG data URLs pass through unchanged', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQ';
    assert.equal(prepareLogoDataUrlForDocumentRender(jpeg), jpeg);
  });

  test('sectioned renderer has no hardcoded logo scale and uses fit var', () => {
    const row: IncomeBrandingProfileRow = {
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
    const logo = `data:image/png;base64,${paddedLogoPng().toString('base64')}`;
    const html = renderIncomeBrandedPreviewHtml({
      branding: resolveBrandingProfile(row, { logo_data_url: logo, signature_data_url: null }),
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
    assert.doesNotMatch(html, /transform: scale\(/);
    assert.match(html, /--nx-doc-logo-fit:\s*92%/);
    assert.match(html, /var\(--nx-doc-logo-fit\)/);
    assert.match(html, /object-fit: contain/);
  });
});
