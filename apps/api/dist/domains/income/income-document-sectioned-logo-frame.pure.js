/**
 * Shared sectioned logo-frame contract — single source of truth for
 * PDF / Preview / Branding Studio guidance.
 *
 * Derived from the sectioned template + issued PDF print wrapper:
 * - Section 1 outer height: 65px (CSS), border 2px, box-sizing border-box → content height 61px
 * - Section padding: 0 8px
 * - Equal half-columns on the upper sheet
 * - Print path: A4 portrait, @page margin 14mm inline
 *   (see wrapUnifiedIncomeDocumentHtmlForPrint)
 *
 * Reference content width at 96dpi:
 *   (210 − 2×14) mm → 182 mm → 688 px
 *   upper-sheet border-box 2px → inner 684 → half column 342
 *   section border 4 + padding 16 → logo frame width 322 px
 *
 * Rendered frame always fills the section-1 content box (width/height 100%);
 * these px values are the issued-PDF reference size for uploads + Studio copy.
 */
export const SECTIONED_LOGO_FRAME = {
    /** Issued-PDF / A4 reference frame width */
    width_px: 322,
    /** Section content height = 65 − 2×2 */
    height_px: 61,
    section_outer_height_px: 65,
    section_border_px: 2,
    section_padding_inline_px: 8,
    a4_content_width_px: 688,
    /** width:height label for humans */
    aspect_ratio_label: '≈ 5.3∶1',
    aspect_ratio: '322:61',
    css_frame_class: 'nx-doc__logo-frame',
};
export function getSectionedLogoFrameMeta() {
    const width_px = SECTIONED_LOGO_FRAME.width_px;
    const height_px = SECTIONED_LOGO_FRAME.height_px;
    return {
        width_px,
        height_px,
        aspect_ratio: SECTIONED_LOGO_FRAME.aspect_ratio,
        aspect_ratio_label: SECTIONED_LOGO_FRAME.aspect_ratio_label,
        recommended_size_hint: [
            `גודל לוגו מומלץ: ${width_px} × ${height_px} פיקסלים`,
            `יחס גובה-רוחב מומלץ: ${SECTIONED_LOGO_FRAME.aspect_ratio_label}`,
            'לוגואים גדולים יותאמו למסגרת ועלולים להיחתך.',
            'לוגואים קטנים יוצגו במרכז על רקע לבן.',
        ].join('\n'),
        css_frame_width: `${width_px}px`,
        css_frame_height: `${height_px}px`,
        css_frame_class: SECTIONED_LOGO_FRAME.css_frame_class,
    };
}
export function buildSectionedLogoFrameRecommendedSizeHint() {
    return getSectionedLogoFrameMeta().recommended_size_hint;
}
