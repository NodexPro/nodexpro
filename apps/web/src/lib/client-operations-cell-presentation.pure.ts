/**
 * Client Operations cell presentation preferences (localStorage).
 * Presentation only — not business truth. Scoped by user + organization.
 * Cell keys match existing cellKey(clientId, colKey) — intentionally not period-specific.
 */

export const CLIENT_OPERATIONS_CELL_PRESENTATION_STORAGE_PREFIX =
  'nx.client-operations.cell-presentation.v1';

export type ClientOperationsStoredCellPresentation = {
  align?: 'right' | 'center' | 'left';
  wrap?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
  fontSize?: number;
  numberFormat?: 'general' | 'number' | 'currency' | 'percent' | 'date';
};

const ALIGNMENTS = new Set(['right', 'center', 'left']);
const NUMBER_FORMATS = new Set(['general', 'number', 'currency', 'percent', 'date']);

export function clientOperationsCellPresentationStorageKey(
  userId: string,
  organizationId: string,
): string {
  return `${CLIENT_OPERATIONS_CELL_PRESENTATION_STORAGE_PREFIX}:${userId}:${organizationId}`;
}

function sanitizePresentation(value: unknown): ClientOperationsStoredCellPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: ClientOperationsStoredCellPresentation = {};
  if (typeof raw.align === 'string' && ALIGNMENTS.has(raw.align)) {
    out.align = raw.align as ClientOperationsStoredCellPresentation['align'];
  }
  if (typeof raw.wrap === 'boolean') out.wrap = raw.wrap;
  if (typeof raw.bold === 'boolean') out.bold = raw.bold;
  if (typeof raw.italic === 'boolean') out.italic = raw.italic;
  if (typeof raw.underline === 'boolean') out.underline = raw.underline;
  if (typeof raw.color === 'string' && raw.color.trim()) out.color = raw.color.trim();
  if (typeof raw.fill === 'string' && raw.fill.trim()) out.fill = raw.fill.trim();
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize)) {
    out.fontSize = Math.round(raw.fontSize);
  }
  if (typeof raw.numberFormat === 'string' && NUMBER_FORMATS.has(raw.numberFormat)) {
    out.numberFormat = raw.numberFormat as ClientOperationsStoredCellPresentation['numberFormat'];
  }
  return Object.keys(out).length ? out : null;
}

export function loadClientOperationsCellPresentation(
  userId: string,
  organizationId: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): Record<string, ClientOperationsStoredCellPresentation> {
  if (!storage || !userId || !organizationId) return {};
  try {
    const raw = storage.getItem(clientOperationsCellPresentationStorageKey(userId, organizationId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        if (!key || typeof key !== 'string') return [];
        const clean = sanitizePresentation(value);
        return clean ? [[key, clean]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function saveClientOperationsCellPresentation(
  userId: string,
  organizationId: string,
  presentation: Record<string, ClientOperationsStoredCellPresentation>,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  if (!storage || !userId || !organizationId) return;
  const clean = Object.fromEntries(
    Object.entries(presentation).flatMap(([key, value]) => {
      const next = sanitizePresentation(value);
      return next ? [[key, next]] : [];
    }),
  );
  try {
    storage.setItem(
      clientOperationsCellPresentationStorageKey(userId, organizationId),
      JSON.stringify(clean),
    );
  } catch {
    // Preferences are non-critical and may be unavailable in private browsing.
  }
}
