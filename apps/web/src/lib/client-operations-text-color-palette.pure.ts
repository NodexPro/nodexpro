/**
 * Curated text-color palette for Client Operations spreadsheet (presentation only).
 */

export type ClientOperationsTextColorSwatch = {
  id: string;
  hex: string;
  label_he: string;
  row: 'standard' | 'beautiful';
};

/** Exactly 12 restrained professional + distinctive colors. */
export const CLIENT_OPERATIONS_TEXT_COLOR_PALETTE: readonly ClientOperationsTextColorSwatch[] = [
  { id: 'ink', hex: '#111827', label_he: 'שחור', row: 'standard' },
  { id: 'slate', hex: '#475569', label_he: 'אפור כהה', row: 'standard' },
  { id: 'nova', hex: '#123756', label_he: 'נובה', row: 'standard' },
  { id: 'blue', hex: '#1d4ed8', label_he: 'כחול', row: 'standard' },
  { id: 'deep_green', hex: '#166534', label_he: 'ירוק עמוק', row: 'standard' },
  { id: 'burgundy', hex: '#7f1d1d', label_he: 'בורדו', row: 'standard' },
  { id: 'orchid', hex: '#9d4edd', label_he: 'סחלב', row: 'beautiful' },
  { id: 'lavender', hex: '#7c3aed', label_he: 'לבנדר', row: 'beautiful' },
  { id: 'dusty_rose', hex: '#c26b7a', label_he: 'ורוד עמום', row: 'beautiful' },
  { id: 'sage', hex: '#6b8f71', label_he: 'מרווה', row: 'beautiful' },
  { id: 'teal', hex: '#0f766e', label_he: 'טורקיז', row: 'beautiful' },
  { id: 'terracotta', hex: '#c05621', label_he: 'טרקוטה', row: 'beautiful' },
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
