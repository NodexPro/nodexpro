const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AdditionalLoginEmailStatus =
  | 'pending_verification'
  | 'pending_replacement'
  | 'verified'
  | 'revoked';

export type AdditionalLoginEmailRow = {
  email: string;
  status: AdditionalLoginEmailStatus;
};

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return email.length > 3 && email.length <= 254 && EMAIL_RE.test(email);
}

export function validateNewPassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (password.length > 128) return 'Password is too long.';
  return null;
}

export function assertPasswordConfirmation(password: string, confirmation: string): string | null {
  if (password !== confirmation) return 'New password and confirmation do not match.';
  return validateNewPassword(password);
}

/** Resolve a login identifier to the canonical Supabase email. Never expose this mapping to clients. */
export function resolveCanonicalLoginEmail(input: {
  identifier: string;
  verifiedSecondary: { email: string; primaryEmail: string } | null;
}): string {
  const identifier = normalizeEmail(input.identifier);
  if (
    input.verifiedSecondary &&
    normalizeEmail(input.verifiedSecondary.email) === identifier &&
    input.verifiedSecondary.primaryEmail
  ) {
    return normalizeEmail(input.verifiedSecondary.primaryEmail);
  }
  return identifier;
}

export function canRequestAdditionalEmail(input: {
  primaryEmail: string;
  requestedEmail: string;
  existing: AdditionalLoginEmailRow[];
  emailsRegisteredToOtherAccounts: string[];
}): { ok: true } | { ok: false; code: string; message: string } {
  const requested = normalizeEmail(input.requestedEmail);
  const primary = normalizeEmail(input.primaryEmail);
  if (!isValidEmail(requested)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' };
  }
  if (requested === primary) {
    return { ok: false, code: 'SAME_AS_PRIMARY', message: 'Additional email must differ from the primary login email.' };
  }
  if (input.emailsRegisteredToOtherAccounts.map(normalizeEmail).includes(requested)) {
    return { ok: false, code: 'EMAIL_TAKEN', message: 'This email cannot be used.' };
  }
  const active = input.existing.filter((row) => row.status !== 'revoked');
  const pending = active.filter(
    (row) => row.status === 'pending_verification' || row.status === 'pending_replacement',
  );
  if (pending.length > 0) {
    return {
      ok: false,
      code: 'PENDING_EXISTS',
      message: 'A verification is already pending. Resend, wait, or remove it first.',
    };
  }
  const verified = active.filter((row) => row.status === 'verified');
  if (verified.length > 0) {
    return {
      ok: false,
      code: 'VERIFIED_EXISTS',
      message: 'Replace the existing additional email instead of adding another.',
    };
  }
  return { ok: true };
}

export function canReplaceAdditionalEmail(input: {
  primaryEmail: string;
  requestedEmail: string;
  existing: AdditionalLoginEmailRow[];
  emailsRegisteredToOtherAccounts: string[];
}): { ok: true } | { ok: false; code: string; message: string } {
  const requested = normalizeEmail(input.requestedEmail);
  const primary = normalizeEmail(input.primaryEmail);
  if (!isValidEmail(requested)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Enter a valid email address.' };
  }
  if (requested === primary) {
    return { ok: false, code: 'SAME_AS_PRIMARY', message: 'Additional email must differ from the primary login email.' };
  }
  if (input.emailsRegisteredToOtherAccounts.map(normalizeEmail).includes(requested)) {
    return { ok: false, code: 'EMAIL_TAKEN', message: 'This email cannot be used.' };
  }
  const active = input.existing.filter((row) => row.status !== 'revoked');
  const verified = active.filter((row) => row.status === 'verified');
  if (verified.length === 0) {
    return { ok: false, code: 'NO_VERIFIED_SECONDARY', message: 'There is no verified additional email to replace.' };
  }
  if (verified.some((row) => row.email === requested)) {
    return { ok: false, code: 'SAME_AS_CURRENT', message: 'This additional email is already verified.' };
  }
  const pending = active.filter(
    (row) => row.status === 'pending_verification' || row.status === 'pending_replacement',
  );
  if (pending.length > 0) {
    return {
      ok: false,
      code: 'PENDING_EXISTS',
      message: 'A replacement verification is already pending.',
    };
  }
  return { ok: true };
}

export function additionalEmailAllowedActions(existing: AdditionalLoginEmailRow[]): string[] {
  const active = existing.filter((row) => row.status !== 'revoked');
  const verified = active.find((row) => row.status === 'verified') ?? null;
  const pending = active.find(
    (row) => row.status === 'pending_verification' || row.status === 'pending_replacement',
  );
  const actions: string[] = [];
  if (!verified && !pending) actions.push('request_additional_login_email');
  if (pending) {
    actions.push('resend_additional_login_email');
    actions.push('remove_additional_login_email');
  }
  if (verified && !pending) {
    actions.push('replace_additional_login_email');
    actions.push('remove_additional_login_email');
  }
  return actions;
}
