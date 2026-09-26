/**
 * USER/custom Excel cell display (presentation only — not business truth).
 * Empty values must render as blank, never em-dash.
 */

export function formatCustomExcelCellDisplay(value: string | null | undefined): string {
  if (value == null || value === '' || value === '—' || value === '-') return '';
  return String(value);
}

export function isSystemDashDisplayAllowed(cellKind: string | null | undefined): boolean {
  return cellKind !== 'custom';
}
