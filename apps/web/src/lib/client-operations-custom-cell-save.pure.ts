/**
 * Per-cell autosave concurrency (interaction mechanics only — not business truth).
 * Single-flight + latest-draft coalescing. Different cell keys never share a queue.
 */

export type CustomCellSaveIdentity = {
  organizationId: string;
  clientId: string;
  columnId: string;
  operationalPeriodKey: string;
};

export function customCellSaveKey(identity: CustomCellSaveIdentity): string {
  return `${identity.organizationId}:${identity.clientId}:${identity.columnId}:${identity.operationalPeriodKey}`;
}

export type CustomCellSaveSlot = {
  /** True while a value-save command is in flight for this cell. */
  inFlight: boolean;
  /** Value of the in-flight command (the value actually sent). */
  sentValue: string | null;
  /** Newest dirty draft; coalesced while in flight / between debounce fires. */
  latestDraft: string | null;
};

export type CustomCellSaveStart = {
  key: string;
  value: string;
  identity: CustomCellSaveIdentity;
};

function emptySlot(): CustomCellSaveSlot {
  return { inFlight: false, sentValue: null, latestDraft: null };
}

/** Remember the newest draft for a cell (typing / blur / Enter). Does not start a request. */
export function rememberCustomCellDraft(
  slots: Map<string, CustomCellSaveSlot>,
  identity: CustomCellSaveIdentity,
  draft: string,
): string {
  const key = customCellSaveKey(identity);
  const prev = slots.get(key) ?? emptySlot();
  slots.set(key, { ...prev, latestDraft: draft });
  return key;
}

/**
 * Start a save if the cell has a dirty draft and nothing is in flight.
 * Returns the payload to send, or null if idle / waiting on in-flight.
 */
export function tryStartCustomCellSave(
  slots: Map<string, CustomCellSaveSlot>,
  identity: CustomCellSaveIdentity,
  serverValue: string,
): CustomCellSaveStart | null {
  const key = customCellSaveKey(identity);
  const slot = slots.get(key) ?? emptySlot();
  if (slot.inFlight) return null;
  const draft = slot.latestDraft;
  if (draft == null) return null;
  if (draft === serverValue) {
    slots.set(key, emptySlot());
    return null;
  }
  slots.set(key, { inFlight: true, sentValue: draft, latestDraft: draft });
  return { key, value: draft, identity };
}

/**
 * After a successful save: clear flight; if a newer draft exists, start exactly one next save.
 * `applyAggregateRecommended` is true when the completed value is still the latest draft
 * (no newer local typing that would be clobbered by painting server "ab" over "abcd").
 */
export function completeCustomCellSaveSuccess(
  slots: Map<string, CustomCellSaveSlot>,
  key: string,
  completedValue: string,
  serverValueAfter: string,
): { startNext: CustomCellSaveStart | null; applyAggregateRecommended: boolean; slot: CustomCellSaveSlot } {
  const slot = slots.get(key) ?? emptySlot();
  const latest = slot.latestDraft;
  const newerPending = latest != null && latest !== completedValue;
  if (newerPending) {
    const identity = parseCustomCellSaveKey(key);
    slots.set(key, { inFlight: true, sentValue: latest, latestDraft: latest });
    return {
      startNext: identity ? { key, value: latest, identity } : null,
      applyAggregateRecommended: false,
      slot: slots.get(key)!,
    };
  }
  // No newer draft: clear if server matches, else keep draft for error/retry UX (caller decides).
  if (completedValue === serverValueAfter || latest === serverValueAfter || latest === completedValue) {
    slots.set(key, emptySlot());
  } else {
    slots.set(key, { inFlight: false, sentValue: null, latestDraft: latest });
  }
  return {
    startNext: null,
    applyAggregateRecommended: true,
    slot: slots.get(key) ?? emptySlot(),
  };
}

/** On failure: leave latest draft intact, clear in-flight, do not auto-retry. */
export function completeCustomCellSaveFailure(
  slots: Map<string, CustomCellSaveSlot>,
  key: string,
): CustomCellSaveSlot {
  const slot = slots.get(key) ?? emptySlot();
  const next: CustomCellSaveSlot = {
    inFlight: false,
    sentValue: null,
    latestDraft: slot.latestDraft ?? slot.sentValue,
  };
  slots.set(key, next);
  return next;
}

export function getCustomCellSlot(slots: Map<string, CustomCellSaveSlot>, key: string): CustomCellSaveSlot {
  return slots.get(key) ?? emptySlot();
}

export function isCustomCellInFlight(slots: Map<string, CustomCellSaveSlot>, key: string): boolean {
  return Boolean(slots.get(key)?.inFlight);
}

/** Visible editor value: never replace a newer local draft with an older server cell. */
export function resolveCustomCellEditorDraft(input: {
  stillEditing: boolean;
  localDraft: string;
  latestDraft: string | null;
  serverCellValue: string;
}): string {
  if (!input.stillEditing) return input.serverCellValue;
  if (input.latestDraft != null && input.latestDraft !== input.serverCellValue) return input.latestDraft;
  if (input.localDraft !== input.serverCellValue) return input.localDraft;
  return input.serverCellValue;
}

/** Late response for period A must not paint while viewing period B. */
export function shouldApplyCellSaveAggregate(input: {
  responsePeriodKey: string | null | undefined;
  viewedPeriodKey: string | null | undefined;
}): boolean {
  const response = String(input.responsePeriodKey ?? '').trim();
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!response || !viewed) return false;
  return response === viewed;
}

/**
 * Manual draft overlay is presentation-only and MUST be period-scoped.
 * Same row_key/col across months must never share an overlay entry.
 */
export function manualDraftOverlayKey(
  periodKey: string,
  rowKey: string,
  colKey: string,
): string {
  return `${String(periodKey ?? '').trim()}::${String(rowKey ?? '').trim()}::${String(colKey ?? '').trim()}`;
}

/** Overlay writes only while viewing the draft's own period (blocks cross-month bleed). */
export function shouldWriteManualDraftOverlay(input: {
  writePeriodKey: string | null | undefined;
  viewedPeriodKey: string | null | undefined;
}): boolean {
  const write = String(input.writePeriodKey ?? '').trim();
  const viewed = String(input.viewedPeriodKey ?? '').trim();
  if (!write || !viewed) return false;
  return write === viewed;
}

/**
 * Successful cell-save with no newer pending draft:
 * - paint only when response period === viewed period
 * - always cache under the response period identity when applyAggregateRecommended
 */
export function shouldCacheCellSaveAggregate(input: {
  applyAggregateRecommended: boolean;
  responsePeriodKey: string | null | undefined;
}): boolean {
  if (!input.applyAggregateRecommended) return false;
  return Boolean(String(input.responsePeriodKey ?? '').trim());
}

/** Any dirty draft or in-flight save that must flush before period navigation. */
export function listDirtyCustomCellKeys(slots: Map<string, CustomCellSaveSlot>): string[] {
  const out: string[] = [];
  for (const [key, slot] of slots) {
    // Empty-string draft is dirty (sparse DELETE) — must flush on period switch.
    if (slot.inFlight || slot.latestDraft != null) {
      out.push(key);
    }
  }
  return out;
}

/**
 * Parse save key. Period is always trailing YYYY-MM.
 * clientId may contain colons (manual:01). organizationId is a UUID (no colons).
 */
export function parseCustomCellSaveKey(key: string): CustomCellSaveIdentity | null {
  const periodMatch = /:(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(key);
  if (!periodMatch) return null;
  const operationalPeriodKey = periodMatch[1]!;
  const withoutPeriod = key.slice(0, -(operationalPeriodKey.length + 1));
  const lastColon = withoutPeriod.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const columnId = withoutPeriod.slice(lastColon + 1);
  const orgAndClient = withoutPeriod.slice(0, lastColon);
  const firstColon = orgAndClient.indexOf(':');
  if (firstColon <= 0) return null;
  const organizationId = orgAndClient.slice(0, firstColon);
  const clientId = orgAndClient.slice(firstColon + 1);
  if (!organizationId || !clientId || !columnId) return null;
  return { organizationId, clientId, columnId, operationalPeriodKey };
}

/** Overlay dirty latestDraft onto manual_rows so stale aggregate cannot revert newer typing. */
export function reconcileManualRowsWithDirtyDrafts<T extends {
  row_key: string;
  cells: Record<string, string>;
}>(input: {
  manualRows: T[];
  slots: Map<string, CustomCellSaveSlot>;
  organizationId: string;
  viewedPeriodKey: string;
}): T[] {
  const org = String(input.organizationId ?? '').trim();
  const period = String(input.viewedPeriodKey ?? '').trim();
  if (!org || !period || !input.manualRows.length) return input.manualRows;

  let changed = false;
  const next = input.manualRows.map((row) => {
    let cells = row.cells;
    let rowChanged = false;
    for (const [columnKey, serverValue] of Object.entries(row.cells ?? {})) {
      const key = customCellSaveKey({
        organizationId: org,
        clientId: row.row_key,
        columnId: columnKey,
        operationalPeriodKey: period,
      });
      const slot = input.slots.get(key);
      if (!slot || slot.latestDraft == null) continue;
      if (slot.latestDraft === serverValue) continue;
      if (!rowChanged) {
        cells = { ...row.cells };
        rowChanged = true;
      }
      cells[columnKey] = slot.latestDraft;
    }
    if (!rowChanged) return row;
    changed = true;
    return { ...row, cells };
  });
  return changed ? next : input.manualRows;
}
