/**
 * Curated text-color palette for Client Operations spreadsheet (presentation only).
 */

export type ClientOperationsTextColorSwatch = {
  id: string;
  hex: string;
  label_he: string;
  label_key: string;
  row: 'standard' | 'beautiful';
};

/** Exactly 12 restrained professional + distinctive colors. */
export const CLIENT_OPERATIONS_TEXT_COLOR_PALETTE: readonly ClientOperationsTextColorSwatch[] = [
  { id: 'ink', hex: '#111827', label_he: 'שחור', label_key: 'clientOperations.colors.ink', row: 'standard' },
  { id: 'slate', hex: '#475569', label_he: 'אפור כהה', label_key: 'clientOperations.colors.slate', row: 'standard' },
  { id: 'nova', hex: '#123756', label_he: 'נובה', label_key: 'clientOperations.colors.nova', row: 'standard' },
  { id: 'blue', hex: '#1d4ed8', label_he: 'כחול', label_key: 'clientOperations.colors.blue', row: 'standard' },
  { id: 'deep_green', hex: '#166534', label_he: 'ירוק עמוק', label_key: 'clientOperations.colors.deepGreen', row: 'standard' },
  { id: 'burgundy', hex: '#7f1d1d', label_he: 'בורדו', label_key: 'clientOperations.colors.burgundy', row: 'standard' },
  { id: 'orchid', hex: '#9d4edd', label_he: 'סחלב', label_key: 'clientOperations.colors.orchid', row: 'beautiful' },
  { id: 'lavender', hex: '#7c3aed', label_he: 'לבנדר', label_key: 'clientOperations.colors.lavender', row: 'beautiful' },
  { id: 'dusty_rose', hex: '#c26b7a', label_he: 'ורוד עמום', label_key: 'clientOperations.colors.dustyRose', row: 'beautiful' },
  { id: 'sage', hex: '#6b8f71', label_he: 'מרווה', label_key: 'clientOperations.colors.sage', row: 'beautiful' },
  { id: 'teal', hex: '#0f766e', label_he: 'טורקיז', label_key: 'clientOperations.colors.teal', row: 'beautiful' },
  { id: 'terracotta', hex: '#c05621', label_he: 'טרקוטה', label_key: 'clientOperations.colors.terracotta', row: 'beautiful' },
] as const;

export const CLIENT_OPERATIONS_DEFAULT_TEXT_COLOR = '#111827';

export function clientOperationsTextColorPaletteRows(): {
  standard: ClientOperationsTextColorSwatch[];
  beautiful: ClientOperationsTextColorSwatch[];
} {
  return {
    standard: CLIENT_OPERATIONS_TEXT_COLOR_PALETTE.filter((s) => s.row === 'standard'),
    beautiful: CLIENT_OPERATIONS_TEXT_COLOR_PALETTE.filter((s) => s.row === 'beautiful'),
  };
}
