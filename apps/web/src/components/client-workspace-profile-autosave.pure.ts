/** Client Details autosave helpers — presentation + save-queue decisions only. */

export const CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS = 800;

export type ClientProfileDraft = {
  client_name: string;
  government_id: string;
  business_type: string;
  status: string;
  contact_person: string;
  phone: string;
  email: string;
  address_text: string;
  assigned_handler_user_id: string | null;
  ended_at: string;
};

export type ClientProfileCaseSlice = {
  client: {
    client_name?: string | null;
    tax_id?: string | null;
    status?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    ended_at?: string | null;
  };
  profile: {
    business_type?: string | null;
    assigned_handler_user_id?: string | null;
  };
  primary_contact?: {
    full_name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
};

export function isoToDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Backend ALLOWED_BUSINESS_TYPES — Hebrew codes stored on client_operational_profiles. */
export const CLIENT_PROFILE_BUSINESS_TYPE_VALUES = [
  'עוסק פטור',
  'עוסק מורשה',
  'חברה',
  'תאגיד',
  'אחר',
] as const;

export type ClientProfileBusinessTypeValue = (typeof CLIENT_PROFILE_BUSINESS_TYPE_VALUES)[number];

/**
 * Controlled <select> value. Empty stays empty — never coerce to the first option
 * (עוסק פטור). Registry em-dash placeholders are not a business type.
 */
export function hydrateClientProfileBusinessType(raw: string | null | undefined): string {
  const s = String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!s || s === '—' || s === '-') return '';
  return s;
}

/** Keep an unmatched persisted value visible instead of letting the browser show עוסק פטור. */
export function clientProfileBusinessTypeSelectOptions(current: string): string[] {
  const allowed = [...CLIENT_PROFILE_BUSINESS_TYPE_VALUES];
  const hydrated = hydrateClientProfileBusinessType(current);
  if (hydrated && !allowed.includes(hydrated as ClientProfileBusinessTypeValue)) {
    return [hydrated, ...allowed];
  }
  return allowed;
}

export function draftFromClientOperationsCase(workspace: ClientProfileCaseSlice): ClientProfileDraft {
  const displayAddress = [workspace.client.address, workspace.client.city].filter(Boolean).join(' · ');
  return {
    client_name: workspace.client.client_name ?? '',
    government_id: workspace.client.tax_id ?? '',
    business_type: hydrateClientProfileBusinessType(workspace.profile.business_type),
    status: workspace.client.status ?? 'active',
    contact_person: workspace.primary_contact?.full_name ?? '',
    phone: workspace.primary_contact?.phone ?? workspace.client.phone ?? '',
    email: workspace.primary_contact?.email ?? workspace.client.email ?? '',
    address_text: displayAddress,
    assigned_handler_user_id: workspace.profile.assigned_handler_user_id ?? null,
    ended_at: isoToDateInputValue(workspace.client.ended_at),
  };
}

export function clientProfileDraftsEqual(a: ClientProfileDraft, b: ClientProfileDraft): boolean {
  return (
    a.client_name === b.client_name &&
    a.government_id === b.government_id &&
    a.business_type === b.business_type &&
    a.status === b.status &&
    a.contact_person === b.contact_person &&
    a.phone === b.phone &&
    a.email === b.email &&
    a.address_text === b.address_text &&
    a.assigned_handler_user_id === b.assigned_handler_user_id &&
    a.ended_at === b.ended_at
  );
}

export function validateClientProfileDraft(
  draft: ClientProfileDraft,
): { ok: true } | { ok: false; messageHe: string } {
  const phoneTrim = draft.phone.trim();
  const emailTrim = draft.email.trim();
  const businessOk = Boolean(draft.business_type.trim());
  const contactOk = phoneTrim.length > 0 || emailTrim.length > 0;
  const missingLabels: string[] = [];
  if (!businessOk) missingLabels.push('סוג עסק');
  if (!contactOk) missingLabels.push('טלפון או אימייל');
  if (missingLabels.length > 0) {
    return { ok: false, messageHe: `נא למלא פרטים : ${missingLabels.join(', ')}` };
  }
  return { ok: true };
}

export function buildClientProfileUpdatePayload(draft: ClientProfileDraft) {
  return {
    client_name: draft.client_name,
    government_id: draft.government_id,
    business_type: draft.business_type,
    status: draft.status,
    contact_person: draft.contact_person,
    phone: draft.phone,
    email: draft.email,
    address: draft.address_text,
    assigned_handler_user_id: draft.assigned_handler_user_id,
    ended_at: draft.ended_at ? draft.ended_at : null,
  };
}

export function shouldSkipClientProfileSave(
  current: ClientProfileDraft,
  confirmed: ClientProfileDraft,
): boolean {
  return clientProfileDraftsEqual(current, confirmed);
}

/** After a confirmed command response: apply server truth only if the user did not type again. */
export function decideAfterProfileSave(
  sent: ClientProfileDraft,
  current: ClientProfileDraft,
): 'apply_aggregate' | 'keep_local_and_resave' {
  return clientProfileDraftsEqual(sent, current) ? 'apply_aggregate' : 'keep_local_and_resave';
}

export function shouldIgnoreStaleProfileResponse(sentForClientId: string, activeClientId: string): boolean {
  return sentForClientId !== activeClientId;
}

export type ClientProfileSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export type ClientProfileSaveState = { status: ClientProfileSaveStatus; error: string | null };

function cloneDraft(d: ClientProfileDraft): ClientProfileDraft {
  return { ...d };
}

/** Serialized, debounced autosave for פרטי לקוח. Calls the named backend command only; never claims success locally. */
export function createClientProfileAutosaver(options: {
  initial: ClientProfileDraft;
  save: (draft: ClientProfileDraft) => Promise<void>;
  onConfirmed?: (sent: ClientProfileDraft) => void;
  onState: (state: ClientProfileSaveState) => void;
  debounceMs?: number;
  isLocked?: () => boolean;
}) {
  const debounceMs = options.debounceMs ?? CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS;
  let latest = cloneDraft(options.initial);
  let confirmed = cloneDraft(options.initial);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pumping: Promise<boolean> | null = null;
  let disposed = false;
  let state: ClientProfileSaveState = { status: 'idle', error: null };

  const emit = (next: ClientProfileSaveState) => {
    state = next;
    if (!disposed) options.onState(state);
  };

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const dirty = () => !clientProfileDraftsEqual(latest, confirmed);

  const pump = (): Promise<boolean> => {
    if (pumping) return pumping;
    pumping = (async () => {
      try {
        while (dirty()) {
          const sent = cloneDraft(latest);
          const valid = validateClientProfileDraft(sent);
          if (!valid.ok) {
            emit({ status: 'error', error: valid.messageHe });
            return false;
          }
          emit({ status: 'saving', error: null });
          try {
            await options.save(sent);
          } catch (e) {
            emit({
              status: 'error',
              error: e instanceof Error && e.message ? e.message : 'Failed to save',
            });
            return false;
          }
          if (decideAfterProfileSave(sent, latest) === 'keep_local_and_resave') {
            // Keep pumping leftover drafts after dispose so Close / client-switch
            // flush never drops newer local edits. Skip UI apply below.
            continue;
          }
          confirmed = cloneDraft(sent);
          if (!disposed) options.onConfirmed?.(sent);
        }
        if (!disposed) emit({ status: 'saved', error: null });
        return true;
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  };

  const schedule = () => {
    clearTimer();
    if (disposed) return;
    if (options.isLocked?.()) return;
    if (pumping) return;
    if (!dirty()) {
      emit({ status: state.status === 'idle' ? 'idle' : 'saved', error: null });
      return;
    }
    emit({ status: 'pending', error: state.status === 'error' ? state.error : null });
    timer = setTimeout(() => {
      timer = null;
      void pump();
    }, debounceMs);
  };

  return {
    change(draft: ClientProfileDraft) {
      latest = cloneDraft(draft);
      schedule();
    },
    async flush() {
      clearTimer();
      if (!dirty() && !pumping) return state.status !== 'error';
      return pump();
    },
    dispose() {
      clearTimer();
      disposed = true;
    },
    resetFromServer(draft: ClientProfileDraft) {
      latest = cloneDraft(draft);
      confirmed = cloneDraft(draft);
      clearTimer();
      emit({ status: 'idle', error: null });
    },
    isDirty: dirty,
    getState: () => state,
    getLatest: () => cloneDraft(latest),
  };
}

export function clientProfileNeedsLeaveGuard(state: ClientProfileSaveState, isDirty: boolean): boolean {
  return isDirty || state.status === 'pending' || state.status === 'saving' || state.status === 'error';
}

export function clientProfileSaveStateLabelHe(state: ClientProfileSaveState): string | null {
  switch (state.status) {
    case 'pending':
    case 'saving':
      return 'שומר…';
    case 'saved':
      return 'נשמר';
    case 'error':
      return state.error;
    default:
      return null;
  }
}
