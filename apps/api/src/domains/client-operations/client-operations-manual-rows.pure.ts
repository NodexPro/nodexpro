/**
 * Client Operations — five period-scoped MANUAL spreadsheet rows (presentation + carry rules).
 * NOT Core clients. NOT Accounting Base. Presentation/domain identity only.
 * Stage 5.2: manual:01..05 are workspace-scoped. Storage is sparse.
 * client_id stays null. Slots are not visibility grants and must not hydrate a canonical client.
 *
 * OFFICE sheet uses workspace_kind=office and the sentinel subject.
 * Each member sheet uses workspace_kind=member and that member's user id.
 * Existing cells have no worker owner, so backfill attaches them to the OFFICE sheet only.
 */

export const CLIENT_OPERATIONS_MANUAL_OFFICE_SUBJECT_USER_ID =
  '00000000-0000-0000-0000-000000000000';

export type ClientOperationsManualWorkspaceKind = 'office' | 'member';

export type ClientOperationsManualWorkspaceKey = {
  workspace_kind: ClientOperationsManualWorkspaceKind;
  subject_user_id: string;
};

/** Historical cells stay on the OFFICE sheet. updated_by is not an owner. */
export function backfillExistingManualRowsToOfficeWorkspace(): ClientOperationsManualWorkspaceKey {
  return {
    workspace_kind: 'office',
    subject_user_id: CLIENT_OPERATIONS_MANUAL_OFFICE_SUBJECT_USER_ID,
  };
}

/**
 * Storage identity for a workspace the backend has already authorized.
 * OFFICE → sentinel. MY and STAFF → the resolved subject, never a client-supplied id.
 */
export function manualRowWorkspaceKeyForScope(input: {
  scopeKind: 'OFFICE' | 'MY' | 'STAFF';
  workspaceSubjectUserId: string | null;
}): ClientOperationsManualWorkspaceKey {
  if (input.scopeKind === 'OFFICE') {
    return backfillExistingManualRowsToOfficeWorkspace();
  }
  const subject = String(input.workspaceSubjectUserId ?? '').trim().toLowerCase();
  if (!subject || subject === CLIENT_OPERATIONS_MANUAL_OFFICE_SUBJECT_USER_ID) {
    throw new Error('MANUAL_WORKSPACE_SUBJECT_REQUIRED');
  }
  return { workspace_kind: 'member', subject_user_id: subject };
}

export function manualWorkspaceCacheKey(key: ClientOperationsManualWorkspaceKey): string {
  return `${key.workspace_kind}:${key.subject_user_id}`;
}

export function manualRowsShareWorkspace(
  left: ClientOperationsManualWorkspaceKey,
  right: ClientOperationsManualWorkspaceKey,
): boolean {
  return (
    left.workspace_kind === right.workspace_kind && left.subject_user_id === right.subject_user_id
  );
}

export const CLIENT_OPERATIONS_MANUAL_ROW_SLOT_COUNT = 5;

export type ClientOperationsManualRowSlot = 1 | 2 | 3 | 4 | 5;

export type ClientOperationsManualRowCellPresentation = {
  cell_kind: 'folder' | 'manual_text';
  editable: boolean;
};

export type ClientOperationsManualRegistryRow = {
  row_kind: 'manual';
  /** Stable presentation identity — never a fabricated client UUID. */
  row_key: string;
  manual_row_slot: ClientOperationsManualRowSlot;
  /** Always null — manual rows are not Core clients. */
  client_id: null;
  client_name: null;
  cells: Record<string, string>;
  cell_presentation: Record<string, ClientOperationsManualRowCellPresentation>;
};

const EMPTY_DISPLAY = new Set(['', '—', '–', '-', '־', '\u00a0', '\u200b']);

export function clientOperationsManualRowSlots(): ClientOperationsManualRowSlot[] {
  return [1, 2, 3, 4, 5];
}

export function formatClientOperationsManualRowSlot(slot: number): ClientOperationsManualRowSlot {
  const n = Math.trunc(slot);
  if (n < 1 || n > CLIENT_OPERATIONS_MANUAL_ROW_SLOT_COUNT) {
    throw new Error(`manual_row_slot out of range: ${slot}`);
  }
  return n as ClientOperationsManualRowSlot;
}

export function clientOperationsManualRowKey(slot: ClientOperationsManualRowSlot): string {
  return `manual:${String(slot).padStart(2, '0')}`;
}

export function parseClientOperationsManualRowSlot(raw: unknown): ClientOperationsManualRowSlot {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isInteger(n) || n < 1 || n > CLIENT_OPERATIONS_MANUAL_ROW_SLOT_COUNT) {
    throw new Error('manual_row_slot must be an integer 1..5');
  }
  return n as ClientOperationsManualRowSlot;
}

/** Immediately previous calendar operational period (YYYY-MM). No older-month search. */
export function previousOperationalPeriodKey(periodKey: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(periodKey ?? '').trim());
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]);
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  if (year < 1) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function isMeaningfulManualCellValue(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  if (EMPTY_DISPLAY.has(trimmed)) return false;
  return true;
}

export function isClientOperationsManualFreeTextColumnKey(columnKey: string): boolean {
  const key = String(columnKey ?? '').trim();
  if (!key) return false;
  if (key === 'folder') return false;
  return true;
}

export function buildManualRowCellPresentationForColumns(
  columnKeys: readonly string[],
): Record<string, ClientOperationsManualRowCellPresentation> {
  const out: Record<string, ClientOperationsManualRowCellPresentation> = {};
  for (const key of columnKeys) {
    if (key === 'folder') {
      out[key] = { cell_kind: 'folder', editable: false };
      continue;
    }
    if (!isClientOperationsManualFreeTextColumnKey(key)) continue;
    out[key] = { cell_kind: 'manual_text', editable: true };
  }
  return out;
}

export function materializeClientOperationsManualRows(input: {
  columnKeys: readonly string[];
  /** Map `` `${slot}:${columnKey}` `` → value_text */
  valuesBySlotColumn: ReadonlyMap<string, string>;
  searchQ?: string | null;
}): ClientOperationsManualRegistryRow[] {
  const cellPresentation = buildManualRowCellPresentationForColumns(input.columnKeys);
  const q = (input.searchQ ?? '').trim().toLowerCase();
  const rows: ClientOperationsManualRegistryRow[] = [];
  for (const slot of clientOperationsManualRowSlots()) {
    const cells: Record<string, string> = {};
    for (const key of input.columnKeys) {
      if (key === 'folder') {
        cells[key] = '';
        continue;
      }
      cells[key] = input.valuesBySlotColumn.get(`${slot}:${key}`) ?? '';
    }
    if (q) {
      const hit = Object.values(cells).some((v) => v.toLowerCase().includes(q));
      if (!hit) continue;
    }
    rows.push({
      row_kind: 'manual',
      row_key: clientOperationsManualRowKey(slot),
      manual_row_slot: slot,
      client_id: null,
      client_name: null,
      cells,
      cell_presentation: cellPresentation,
    });
  }
  return rows;
}

/** Slot has at least one meaningful value → eligible for carry-forward into next period. */
export function manualRowSlotHasMeaningfulValues(
  valuesByColumn: ReadonlyMap<string, string> | Record<string, string>,
): boolean {
  const entries =
    valuesByColumn instanceof Map ? valuesByColumn.entries() : Object.entries(valuesByColumn);
  for (const [, value] of entries) {
    if (isMeaningfulManualCellValue(value)) return true;
  }
  return false;
}

/**
 * Carry-forward pure: copy previous slot values into new period ONLY when previous slot
 * has meaningful data. Empty previous slot → empty target (no resurrection from older months).
 */
export function planManualRowCarryForward(input: {
  previousValues: Array<{ slot: number; column_key: string; value_text: string }>;
}): Array<{ slot: ClientOperationsManualRowSlot; column_key: string; value_text: string }> {
  const bySlot = new Map<number, Map<string, string>>();
  for (const row of input.previousValues) {
    const slot = Math.trunc(row.slot);
    if (slot < 1 || slot > CLIENT_OPERATIONS_MANUAL_ROW_SLOT_COUNT) continue;
    const key = String(row.column_key ?? '').trim();
    if (!isClientOperationsManualFreeTextColumnKey(key)) continue;
    let map = bySlot.get(slot);
    if (!map) {
      map = new Map();
      bySlot.set(slot, map);
    }
    map.set(key, String(row.value_text ?? ''));
  }
  const out: Array<{ slot: ClientOperationsManualRowSlot; column_key: string; value_text: string }> = [];
  for (const slot of clientOperationsManualRowSlots()) {
    const map = bySlot.get(slot);
    if (!map || !manualRowSlotHasMeaningfulValues(map)) continue;
    for (const [column_key, value_text] of map.entries()) {
      if (!isMeaningfulManualCellValue(value_text)) continue;
      out.push({ slot, column_key, value_text: value_text.trim() });
    }
  }
  return out;
}

export function isManualRowCompletelyEmptyForPrint(row: {
  cells?: Record<string, string | null | undefined>;
}): boolean {
  const cells = row.cells ?? {};
  for (const [key, value] of Object.entries(cells)) {
    if (key === 'folder') continue;
    if (isMeaningfulManualCellValue(value)) return false;
  }
  return true;
}
