/**
 * Sectioned logo guidance — Branding Studio upload target + render-area reference.
 *
 * Golden-master layout no longer freezes a 65px logo-only row or Excel sheet cells.
 * The printable branding column sizes the logo with object-fit: contain (max height 56px).
 * Upload guidance remains a wide horizontal lockup (~5.3∶1).
 */
/** Preferred source/upload resolution (~5.3∶1 horizontal lockup). */
export const SECTIONED_LOGO_RECOMMENDED_UPLOAD = {
    width_px: 1288,
    height_px: 244,
};
/**
 * Approximate branding-column logo box used by the visible-fit processor diagnostics.
 * Not a hard CSS lock for a logo-only row.
 */
export const SECTIONED_LOGO_FRAME = {
    width_px: 340,
    height_px: 56,
    /** @deprecated — old 65px logo-only row removed */
    section_outer_height_px: 0,
    section_border_px: 0,
    section_padding_inline_px: 0,
    a4_content_width_px: 688,
    aspect_ratio_label: '≈ 5.3∶1',
    aspect_ratio: '1288:244',
    css_frame_class: 'nx-doc__logo-frame',
};
export function getSectionedLogoFrameMeta() {
    const uploadW = SECTIONED_LOGO_RECOMMENDED_UPLOAD.width_px;
    const uploadH = SECTIONED_LOGO_RECOMMENDED_UPLOAD.height_px;
    return {
        width_px: uploadW,
        height_px: uploadH,
        aspect_ratio: SECTIONED_LOGO_FRAME.aspect_ratio,
        aspect_ratio_label: SECTIONED_LOGO_FRAME.aspect_ratio_label,
        recommended_size_hint: [
            `גודל לוגו מומלץ: ${uploadW} × ${uploadH} פיקסלים`,
            `יחס גובה-רוחב מומלץ: ${SECTIONED_LOGO_FRAME.aspect_ratio_label}`,
            'העלו לוגו אופקי מלא (אייקון + מילה + סלוגן אם קיים) ללא שוליים גדולים.',
            'הלוגו מותאם לעמודת המיתוג במסמך ללא מתיחה או חיתוך.',
        ].join('\n'),
        css_frame_width: `${SECTIONED_LOGO_FRAME.width_px}px`,
        css_frame_height: `${SECTIONED_LOGO_FRAME.height_px}px`,
        css_frame_class: SECTIONED_LOGO_FRAME.css_frame_class,
    };
}
export function buildSectionedLogoFrameRecommendedSizeHint() {
    return getSectionedLogoFrameMeta().recommended_size_hint;
}
