/**
 * Registry cell text color — presentation only.
 * Semantic status uses cell fills (ready / sent_for_approval / completed),
 * not purple text. Default readable navy is used when no user color is set.
 */

export const CLIENT_OPERATIONS_REGISTRY_NAVY_TEXT = '#102a4c';

/** Brand / CSS-token violets that are not the user Excel text palette. */
const ACCIDENTAL_PURPLE = new Set([
  '#6657e8',
  '#8074f2',
  '#8b5cf6',
  '#6d28d9',
  '#4f46e5',
]);

function normalizeHex(color: string): string {
  return color.trim().toLowerCase();
}

export function isAccidentalRegistryPurpleText(color: string | null | undefined): boolean {
  if (!color) return false;
  return ACCIDENTAL_PURPLE.has(normalizeHex(color));
}

/**
 * Resolve the CSS color for a registry cell.
 * User Excel formatting is preserved except accidental brand/palette purples
 * that are not a backend semantic status token.
 */
export function resolveRegistryCellTextColor(presentationColor: string | null | undefined): string | undefined {
  if (!presentationColor || !presentationColor.trim()) return undefined;
  if (isAccidentalRegistryPurpleText(presentationColor)) return CLIENT_OPERATIONS_REGISTRY_NAVY_TEXT;
  return presentationColor;
}
