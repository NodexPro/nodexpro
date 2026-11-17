/**
 * Decorative fill palette for Client Operations spreadsheet cells.
 * Presentation only — never filing, payment, overdue, row_tone, or KPI truth.
 */

export type ClientOperationsFillSwatch = {
  id: string;
  hex: string;
  group: string;
  shade: number;
};

export const CLIENT_OPERATIONS_FILL_WHITE = '#ffffff';

const FILL_GROUPS = [
  { id: 'red', hue: 4 },
  { id: 'orange', hue: 28 },
  { id: 'yellow', hue: 48 },
  { id: 'green', hue: 142 },
  { id: 'teal', hue: 174 },
  { id: 'blue', hue: 210 },
  { id: 'purple', hue: 262 },
  { id: 'magenta', hue: 322 },
] as const;

/** Dark → light, ten steps per group. */
const FILL_LIGHTNESS = [18, 28, 38, 48, 58, 68, 76, 84, 90, 96] as const;
const FILL_SATURATION = [78, 76, 74, 72, 68, 62, 56, 48, 38, 28] as const;

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function clientOperationsFillPaletteGroups(): ClientOperationsFillSwatch[][] {
  return FILL_GROUPS.map((group) =>
    FILL_LIGHTNESS.map((lightness, index) => ({
      id: `${group.id}-${index + 1}`,
      hex: hslToHex(group.hue, FILL_SATURATION[index] ?? 50, lightness),
      group: group.id,
      shade: index + 1,
    })),
  );
}

export function clientOperationsFillPaletteFlat(): ClientOperationsFillSwatch[] {
  return clientOperationsFillPaletteGroups().flat();
}

export function isClientOperationsFillHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeClientOperationsFill(value: unknown): string | null {
  if (value == null || value === '' || value === 'none' || value === 'transparent') return null;
  if (!isClientOperationsFillHex(value)) return null;
  return value.toLowerCase();
}
