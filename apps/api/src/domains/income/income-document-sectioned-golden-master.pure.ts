/**
 * Pixel contract measured from:
 * New folder/ChatGPT Image Jul 11, 2026, 04_52_58 PM.png
 *
 * Source image: 1055×1491
 * Content bbox width: 997px
 * Scale to A4 content width @96dpi with 12mm side margins: 703/997
 *
 * These values drive sectioned printable CSS. Do not “improve” them.
 */

import type { IncomeLogoSizeKey } from './income-document-branding.types.js';

/**
 * Studio logo size → scale of golden-master logo lockup (300×70).
 * `large` targets ~20% of A4 page width (and not less than GM artwork).
 * Title font size is never reduced.
 */
export function resolveSectionedBrandingLayoutScale(logoSizeKey: IncomeLogoSizeKey): number {
  if (logoSizeKey === 'large') return 1;
  if (logoSizeKey === 'small') return 0.7;
  return 0.85;
}

export function resolveSectionedBrandingLayout(logoSizeKey: IncomeLogoSizeKey): {
  scale: number;
  logo_block_width_px: number;
  logo_block_height_px: number;
  branding_col_width_px: number;
  doc_col_width_px: number;
  customer_card_width_px: number;
} {
  const scale = resolveSectionedBrandingLayoutScale(logoSizeKey);
  const contentW = SECTIONED_GOLDEN_MASTER.page.content_width_px;
  const a4W = SECTIONED_GOLDEN_MASTER.page.a4_width_px;
  /* Equal upper columns (logo zone | document zone). */
  const brandingCol = Math.floor(contentW / 2);
  const docCol = contentW - brandingCol;
  const gmW = SECTIONED_GOLDEN_MASTER.upper.logo_block_width_px;
  const gmH = SECTIONED_GOLDEN_MASTER.upper.logo_block_height_px;
  const aspect = gmW / gmH;
  /* גדול: at least 20% of A4 width, never below GM lockup so the logo stays visible. */
  const largeTargetW = Math.max(gmW, Math.round(a4W * 0.2));
  const baseW = logoSizeKey === 'large' ? largeTargetW : gmW;
  const logoW = Math.min(Math.max(1, Math.round(baseW * scale)), brandingCol);
  const logoH = Math.max(1, Math.round(logoW / aspect));
  const customerCard = Math.min(SECTIONED_GOLDEN_MASTER.upper.customer_card_width_px, docCol);
  return {
    scale,
    logo_block_width_px: logoW,
    logo_block_height_px: logoH,
    branding_col_width_px: brandingCol,
    doc_col_width_px: docCol,
    customer_card_width_px: customerCard,
  };
}

export const SECTIONED_GOLDEN_MASTER = {
  source_image: {
    width_px: 1055,
    height_px: 1491,
    content_width_px: 997,
    content_height_px: 1449,
  },
  page: {
    a4_width_px: 794,
    a4_height_px: 1123,
    content_width_px: 703,
    margin_left_px: 45,
    margin_right_px: 45,
    margin_top_px: 38,
    margin_bottom_px: 45,
  },
  colors: {
    primary: '#5E42D3',
    text: '#1D1D35',
    muted: '#666666',
    panel: '#F7F6FE',
    white: '#FFFFFF',
    divider: '#E8E8F0',
    row_border: '#ECECF4',
  },
  upper: {
    branding_col_width_px: 339,
    doc_col_width_px: 363,
    column_gap_px: 0,
    /**
     * VISIBLE logo artwork bbox on the golden master (painted pixels),
     * not an empty container. Frame must be at least this size so
     * object-fit:contain can paint the artwork at GM visual dominance.
     * Measured: logo art 251×58 vs title ink 207×23 (logo taller + wider).
     */
    /**
     * Logo must dominate the title visually (wider + taller than title ink).
     * Prior 251×58 was correct as GM bbox but painted too small against
     * classic max-height:40px bleed and sparse upper gaps — keep GM ratio,
     * slightly stronger presence in the branding column.
     */
    logo_visible_artwork_width_px: 300,
    logo_visible_artwork_height_px: 70,
    logo_block_width_px: 300,
    logo_block_height_px: 70,
    title_visible_artwork_width_px: 207,
    title_visible_artwork_height_px: 23,
    logo_to_company_gap_px: 10,
    company_name_font_size_px: 14,
    company_line_font_size_px: 12,
    company_line_gap_px: 5,
    title_font_size_px: 32,
    title_line_height: 1.1,
    title_to_number_gap_px: 10,
    number_bar_width_px: 259,
    number_bar_height_px: 39,
    number_bar_radius_px: 8,
    number_bar_font_size_px: 15,
    meta_row_gap_px: 8,
    meta_font_size_px: 12,
    customer_card_width_px: 330,
    /** Soft guide only — card height follows content (no forced empty 200px). */
    customer_card_height_px: 0,
    customer_card_radius_px: 12,
    customer_card_padding_px: 14,
    customer_top_gap_px: 10,
    upper_to_table_gap_px: 14,
  },
  table: {
    header_height_px: 30,
    row_height_px: 71,
    header_font_size_px: 12,
    cell_font_size_px: 12,
    radius_px: 12,
  },
  lower: {
    notes_totals_height_px: 204,
    notes_totals_gap_px: 16,
    notes_totals_radius_px: 12,
    grand_total_font_size_px: 22,
    payment_section_gap_px: 16,
    payment_card_height_px: 130,
    payment_card_radius_px: 12,
    payment_card_gap_px: 16,
    footer_height_px: 40,
    footer_font_size_px: 11,
  },
} as const;

export type SectionedGoldenMaster = typeof SECTIONED_GOLDEN_MASTER;
