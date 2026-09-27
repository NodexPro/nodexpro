/**
 * Per-cell manual-status paint concurrency (presentation mechanics only).
 * Same cell: single-flight + latest intent. Different cells: independent.
 */

export type ManualStatusPaintIntent = 'ready' | 'sent_for_approval' | 'completed' | null;

export type ManualStatusPaintSlot = {
  inFlight: boolean;
  /** Status currently being written (if any). */
  sentStatus: ManualStatusPaintIntent | undefined;
  /** Newest requested status; coalesced while in flight. */
  latestIntent: ManualStatusPaintIntent | undefined;
};

export type ManualStatusPaintStart = {
  key: string;
  status: ManualStatusPaintIntent;
};

function emptySlot(): ManualStatusPaintSlot {
  return { inFlight: false, sentStatus: undefined, latestIntent: undefined };
}

export function rememberManualStatusPaintIntent(
  slots: Map<string, ManualStatusPaintSlot>,
  key: string,
  intent: ManualStatusPaintIntent,
): void {
  const prev = slots.get(key) ?? emptySlot();
  slots.set(key, { ...prev, latestIntent: intent });
}

/**
 * Start a paint write if idle and a latest intent exists.
 * Returns null while in flight (caller must not open a parallel write).
 */
export function tryStartManualStatusPaint(
  slots: Map<string, ManualStatusPaintSlot>,
  key: string,
): ManualStatusPaintStart | null {
  const slot = slots.get(key) ?? emptySlot();
  if (slot.inFlight) return null;
  if (slot.latestIntent === undefined) return null;
  const status = slot.latestIntent;
  slots.set(key, { inFlight: true, sentStatus: status, latestIntent: status });
  return { key, status };
}

/**
 * After a successful write: if a newer intent arrived, return the next start;
 * otherwise clear the slot.
 */
export function completeManualStatusPaintSuccess(
  slots: Map<string, ManualStatusPaintSlot>,
  key: string,
  completedStatus: ManualStatusPaintIntent,
): { startNext: ManualStatusPaintStart | null; applyAggregateRecommended: boolean } {
  const slot = slots.get(key) ?? emptySlot();
  const latest = slot.latestIntent;
  const newerPending = latest !== undefined && latest !== completedStatus;
  if (newerPending) {
    slots.set(key, { inFlight: true, sentStatus: latest, latestIntent: latest });
    return {
      startNext: { key, status: latest as ManualStatusPaintIntent },
      applyAggregateRecommended: false,
    };
  }
  slots.set(key, emptySlot());
  return { startNext: null, applyAggregateRecommended: true };
}

export function completeManualStatusPaintFailure(
  slots: Map<string, ManualStatusPaintSlot>,
  key: string,
): void {
  const slot = slots.get(key) ?? emptySlot();
  slots.set(key, {
    inFlight: false,
    sentStatus: undefined,
    latestIntent: slot.latestIntent,
  });
}

export function isManualStatusPaintInFlight(
  slots: Map<string, ManualStatusPaintSlot>,
  key: string,
): boolean {
  return Boolean(slots.get(key)?.inFlight);
}
