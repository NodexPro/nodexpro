/**
 * Settings autosave plumbing — when to persist, never what the fields mean.
 * Domain payloads are forwarded to existing organization-settings PATCH /
 * set_localization_preferences. No frontend business truth.
 */

export const SETTINGS_AUTOSAVE_DEBOUNCE_MS = 800;

export type SettingsAutosaveDomain = 'profile' | 'document' | 'bank' | 'signature' | 'localization';

export type SettingsAutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const PROFILE_KEYS = [
  'organizationName',
  'legalEntityType',
  'legalIdNumber',
  'addressLine1',
  'addressLine2',
  'city',
  'postalCode',
  'country',
  'phone',
  'website',
] as const;

export const DOCUMENT_KEYS = [
  'displayNameOnDocuments',
  'displayPhoneOnDocuments',
  'displayWebsiteOnDocuments',
  'displayAddressOnDocuments',
  'documentFooterNote',
] as const;

export const BANK_KEYS = [
  'bankAccountHolder',
  'bankName',
  'bankBranch',
  'bankAccountNumber',
  'iban',
  'swift',
  'displayBankDetailsOnDocuments',
] as const;

export const SIGNATURE_KEYS = ['signatureText'] as const;

export function domainKeys(domain: Exclude<SettingsAutosaveDomain, 'localization'>): readonly string[] {
  if (domain === 'profile') return PROFILE_KEYS;
  if (domain === 'document') return DOCUMENT_KEYS;
  if (domain === 'bank') return BANK_KEYS;
  return SIGNATURE_KEYS;
}

export function isKnownCountryCode(
  code: string,
  options: ReadonlyArray<{ code: string }>,
): boolean {
  const cc = code.trim().toUpperCase();
  return cc.length === 2 && options.some((opt) => opt.code === cc);
}

export function isWebsiteReadyToPersist(value: string, phase: 'debounce' | 'blur'): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^https?:\/\/$/i.test(trimmed)) return false;
  if (phase === 'debounce' && trimmed.length < 3) return false;
  return true;
}

export function profilePatchFromForm(
  form: Record<string, unknown>,
  options: {
    countryOptions: ReadonlyArray<{ code: string }>;
    includeCountry: boolean;
    persistWebsite: boolean;
    websitePhase: 'debounce' | 'blur';
  },
): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {
    organizationName: String(form.organizationName ?? '') || null,
    legalEntityType: String(form.legalEntityType ?? '') || null,
    legalIdNumber: String(form.legalIdNumber ?? '') || null,
    addressLine1: String(form.addressLine1 ?? '') || null,
    addressLine2: String(form.addressLine2 ?? '') || null,
    city: String(form.city ?? '') || null,
    postalCode: String(form.postalCode ?? '') || null,
    phone: String(form.phone ?? '') || null,
  };
  if (options.includeCountry) {
    const country = String(form.country ?? '').trim().toUpperCase();
    if (!isKnownCountryCode(country, options.countryOptions)) return null;
    payload.country = country;
  }
  if (options.persistWebsite) {
    if (!isWebsiteReadyToPersist(String(form.website ?? ''), options.websitePhase)) return null;
    payload.website = String(form.website ?? '') || null;
  }
  return payload;
}

export function documentPatchFromForm(form: Record<string, unknown>): Record<string, unknown> {
  return {
    displayNameOnDocuments: String(form.displayNameOnDocuments ?? '') || null,
    displayPhoneOnDocuments: !!form.displayPhoneOnDocuments,
    displayWebsiteOnDocuments: !!form.displayWebsiteOnDocuments,
    displayAddressOnDocuments: !!form.displayAddressOnDocuments,
    documentFooterNote: String(form.documentFooterNote ?? '') || null,
  };
}

export function bankPatchFromForm(form: Record<string, unknown>): Record<string, unknown> {
  return {
    bankAccountHolder: String(form.bankAccountHolder ?? '') || null,
    bankName: String(form.bankName ?? '') || null,
    bankBranch: String(form.bankBranch ?? '') || null,
    bankAccountNumber: String(form.bankAccountNumber ?? '') || null,
    iban: String(form.iban ?? '') || null,
    swift: String(form.swift ?? '') || null,
    displayBankDetailsOnDocuments: !!form.displayBankDetailsOnDocuments,
  };
}

export function signaturePatchFromForm(form: Record<string, unknown>): Record<string, unknown> {
  return {
    signatureText: String(form.signatureText ?? '') || null,
  };
}

export function localizationCommandFromForm(loc: {
  language_code: string;
  timezone: string;
  date_format: string;
  display_currency_code: string;
}): { language_code: string; timezone: string; date_format: string; display_currency_code: string } | null {
  if (!loc.language_code.trim() || !loc.timezone.trim() || !loc.date_format.trim() || !loc.display_currency_code.trim()) {
    return null;
  }
  return {
    language_code: loc.language_code,
    timezone: loc.timezone,
    date_format: loc.date_format,
    display_currency_code: loc.display_currency_code,
  };
}

export function mergeFormKeepingDirty(
  serverForm: Record<string, unknown>,
  localForm: Record<string, unknown>,
  dirtyKeys: Iterable<string>,
): Record<string, unknown> {
  const next = { ...serverForm };
  for (const key of dirtyKeys) {
    if (Object.prototype.hasOwnProperty.call(localForm, key)) {
      next[key] = localForm[key];
    }
  }
  return next;
}

export function payloadsEqual(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function nextAutosaveGeneration(current: number): number {
  return current + 1;
}

export function isStaleAutosaveGeneration(requestGeneration: number, latestGeneration: number): boolean {
  return requestGeneration !== latestGeneration;
}

export function hasPendingAutosaveWork(input: {
  statuses: Partial<Record<SettingsAutosaveDomain, SettingsAutosaveStatus>>;
  dirtyCount: number;
}): boolean {
  if (input.dirtyCount > 0) return true;
  return Object.values(input.statuses).some((status) => status === 'saving' || status === 'error');
}

export function fieldDomain(field: string): Exclude<SettingsAutosaveDomain, 'localization'> | null {
  if ((PROFILE_KEYS as readonly string[]).includes(field)) return 'profile';
  if ((DOCUMENT_KEYS as readonly string[]).includes(field)) return 'document';
  if ((BANK_KEYS as readonly string[]).includes(field)) return 'bank';
  if ((SIGNATURE_KEYS as readonly string[]).includes(field)) return 'signature';
  return null;
}
