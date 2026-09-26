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

export function parseCustomCellSaveKey(key: string): CustomCellSaveIdentity | null {
  const parts = key.split(':');
  if (parts.length < 4) return null;
  const operationalPeriodKey = parts[parts.length - 1]!;
  const columnId = parts[parts.length - 2]!;
  const clientId = parts[parts.length - 3]!;
  const organizationId = parts.slice(0, parts.length - 3).join(':');
  if (!organizationId || !clientId || !columnId || !operationalPeriodKey) return null;
  return { organizationId, clientId, columnId, operationalPeriodKey };
}

/** Any dirty draft or in-flight save that must flush before period navigation. */
export function listDirtyCustomCellKeys(slots: Map<string, CustomCellSaveSlot>): string[] {
  const out: string[] = [];
  for (const [key, slot] of slots) {
    if (slot.inFlight || (slot.latestDraft != null && slot.latestDraft !== '')) {
      out.push(key);
    }
  }
  return out;
}
