/**
 * Create-client form helpers. Mirrors Core `createClient` / `assertContactMethod`
 * — does not invent extra domain rules (email format, totals, etc.).
 */

export type CreateClientDraft = {
  tax_id: string;
  display_name: string;
  client_type: string;
  phone: string;
  email: string;
  website: string;
  country_code: string;
  city: string;
  street: string;
  postal_code: string;
};

export type CreateClientField = 'tax_id' | 'display_name' | 'contact' | 'client_type';

export type CreateClientValidation =
  | { ok: true }
  | { ok: false; field: CreateClientField; messageKey: string };

export type CreateClientCommandErrorKind = 'validation' | 'unauthorized' | 'conflict' | 'retryable';

export type CreateClientCommandError = {
  kind: CreateClientCommandErrorKind;
  messageKey: string;
  field: CreateClientField | null;
};

/** Exact Core `assertContactMethod` 400 message. */
export const CORE_CREATE_CLIENT_CONTACT_REQUIRED =
  'Client must have at least one contact method: phone or email.';

const CORE_TAX_ID_REQUIRED = 'tax_id is required';
const CORE_DISPLAY_NAME_REQUIRED = 'display_name is required';
const CORE_INVALID_CLIENT_TYPE = 'Invalid client_type';

/** Same rule as Core `assertContactMethod`: phone OR email after trim. */
export function hasCreateClientContactMethod(phone: string, email: string): boolean {
  return Boolean((phone ?? '').trim() || (email ?? '').trim());
}

export function validateCreateClientDraft(draft: CreateClientDraft): CreateClientValidation {
  if (!draft.tax_id.trim()) {
    return { ok: false, field: 'tax_id', messageKey: 'clients.errors.taxIdRequired' };
  }
  if (!draft.display_name.trim()) {
    return { ok: false, field: 'display_name', messageKey: 'clients.errors.displayNameRequired' };
  }
  if (!hasCreateClientContactMethod(draft.phone, draft.email)) {
    return { ok: false, field: 'contact', messageKey: 'clients.contact.requiredHint' };
  }
  return { ok: true };
}

export function firstInvalidCreateClientFocusField(field: CreateClientField | null): Exclude<CreateClientField, 'contact'> | 'phone' | null {
  if (!field) return null;
  if (field === 'contact') return 'phone';
  return field;
}

/** Named-command payload for POST /organizations/:id/clients. Empty optionals become null. */
export function buildCreateClientCommandPayload(draft: CreateClientDraft) {
  return {
    tax_id: draft.tax_id.trim(),
    display_name: draft.display_name.trim(),
    client_type: draft.client_type,
    phone: draft.phone.trim() || null,
    email: draft.email.trim() || null,
    website: draft.website.trim() || null,
    country_code: draft.country_code.trim().slice(0, 2) || null,
    city: draft.city.trim() || null,
    street: draft.street.trim() || null,
    postal_code: draft.postal_code.trim() || null,
  };
}

function readErrorShape(err: unknown): { status?: number; code?: string; message?: string } {
  if (!err || typeof err !== 'object') {
    return { message: err instanceof Error ? err.message : undefined };
  }
  const rec = err as { status?: unknown; code?: unknown; message?: unknown };
  return {
    status: typeof rec.status === 'number' ? rec.status : undefined,
    code: typeof rec.code === 'string' ? rec.code : undefined,
    message: typeof rec.message === 'string' ? rec.message : undefined,
  };
}

export function mapCreateClientCommandError(err: unknown): CreateClientCommandError {
  const { status, code, message } = readErrorShape(err);
  if (status === 401 || status === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
    return { kind: 'unauthorized', messageKey: 'clients.errors.unauthorized', field: null };
  }
  if (status === 409 || code === 'CONFLICT') {
    return { kind: 'conflict', messageKey: 'clients.errors.duplicateTaxId', field: 'tax_id' };
  }
  if (status === 400 || code === 'BAD_REQUEST') {
    if (message === CORE_CREATE_CLIENT_CONTACT_REQUIRED) {
      return { kind: 'validation', messageKey: 'clients.contact.requiredHint', field: 'contact' };
    }
    if (message === CORE_TAX_ID_REQUIRED) {
      return { kind: 'validation', messageKey: 'clients.errors.taxIdRequired', field: 'tax_id' };
    }
    if (message === CORE_DISPLAY_NAME_REQUIRED) {
      return { kind: 'validation', messageKey: 'clients.errors.displayNameRequired', field: 'display_name' };
    }
    if (message === CORE_INVALID_CLIENT_TYPE) {
      return { kind: 'validation', messageKey: 'clients.errors.invalidType', field: 'client_type' };
    }
    return { kind: 'validation', messageKey: 'clients.errors.validation', field: null };
  }
  return { kind: 'retryable', messageKey: 'clients.errors.retryable', field: null };
}

export function beginExclusiveSubmit(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function endExclusiveSubmit(lock: { current: boolean }): void {
  lock.current = false;
}
