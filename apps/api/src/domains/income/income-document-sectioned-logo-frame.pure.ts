/**
 * Sectioned logo guidance — Branding Studio upload target + render-area reference.
 *
 * Upload: wide horizontal lockup (~5.3∶1).
 * Document paint box for גדול: SECTIONED_LOGO_LARGE_TARGET (319×120), object-fit: fill.
 */

import { SECTIONED_LOGO_LARGE_TARGET } from './income-document-sectioned-golden-master.pure.js';

/** Preferred source/upload resolution (~5.3∶1 horizontal lockup). */
export const SECTIONED_LOGO_RECOMMENDED_UPLOAD = {
  width_px: 1288,
  height_px: 244,
} as const;

/**
 * Approximate branding-column logo box used by the visible-fit processor diagnostics.
 * Not a hard CSS lock for a logo-only row.
 */
export const SECTIONED_LOGO_FRAME = {
  /** Visible logo artwork target in sectioned branding column. */
  width_px: 300,
  height_px: 70,
  /** @deprecated — old 65px logo-only row removed */
  section_outer_height_px: 0,
  section_border_px: 0,
  section_padding_inline_px: 0,
  a4_content_width_px: 688,
  aspect_ratio_label: '≈ 5.3∶1',
  aspect_ratio: '1288:244',
  css_frame_class: 'nx-doc__logo-frame',
} as const;

export type SectionedLogoFrameMeta = {
  width_px: number;
  height_px: number;
  aspect_ratio: string;
  aspect_ratio_label: string;
  recommended_size_hint: string;
  css_frame_width: string;
  css_frame_height: string;
  css_frame_class: string;
};

export function getSectionedLogoFrameMeta(): SectionedLogoFrameMeta {
  const uploadW = SECTIONED_LOGO_RECOMMENDED_UPLOAD.width_px;
  const uploadH = SECTIONED_LOGO_RECOMMENDED_UPLOAD.height_px;
  const paintW = SECTIONED_LOGO_LARGE_TARGET.width_px;
  const paintH = SECTIONED_LOGO_LARGE_TARGET.height_px;
  return {
    width_px: uploadW,
    height_px: uploadH,
    aspect_ratio: SECTIONED_LOGO_FRAME.aspect_ratio,
    aspect_ratio_label: SECTIONED_LOGO_FRAME.aspect_ratio_label,
    recommended_size_hint: [
      `גודל קובץ מומלץ להעלאה: ${uploadW} × ${uploadH} פיקסלים`,
      `מסגרת הלוגו במסמך (גודל «גדול»): ${paintW} × ${paintH} פיקסלים`,
      `יחס מומלץ: ${SECTIONED_LOGO_FRAME.aspect_ratio_label} (אופקי)`,
      'העלו לוגו אופקי מלא (אייקון + שם + סלוגן אם קיים).',
      'מומלץ PNG עם רקע שקוף וללא שוליים לבנים — שוליים שקופים נחתכים אוטומטית.',
      `בבחירת גודל «גדול» הלוגו ממלא את מסגרת ${paintW}×${paintH} במסמך.`,
    ].join('\n'),
    css_frame_width: `${SECTIONED_LOGO_FRAME.width_px}px`,
    css_frame_height: `${SECTIONED_LOGO_FRAME.height_px}px`,
    css_frame_class: SECTIONED_LOGO_FRAME.css_frame_class,
  };
}

export function buildSectionedLogoFrameRecommendedSizeHint(): string {
  return getSectionedLogoFrameMeta().recommended_size_hint;
}
