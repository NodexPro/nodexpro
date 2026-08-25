/**
 * Customer-facing Income document presentation style (INV-13A).
 *
 * Issued documents and customer-facing draft preview share one finished layout:
 * `sectioned`. Branding Studio may still store `classic` / other keys for
 * studio/editor contexts — this helper only applies on printable/preview paths.
 */
/** Canonical finished-document style key for customer-facing render. */
export const CUSTOMER_FACING_INCOME_DOCUMENT_STYLE_KEY = 'sectioned';
/**
 * Resolve branding for customer-facing HTML (draft preview, issued view, PDF).
 * Forces finished `sectioned` layout when the resolved studio profile is not
 * already sectioned. Not conversion-specific.
 */
export function resolveCustomerFacingIncomeDocumentBranding(branding) {
    if (branding.document_style_key === CUSTOMER_FACING_INCOME_DOCUMENT_STYLE_KEY) {
        return branding;
    }
    return {
        ...branding,
        document_style_key: CUSTOMER_FACING_INCOME_DOCUMENT_STYLE_KEY,
    };
}
