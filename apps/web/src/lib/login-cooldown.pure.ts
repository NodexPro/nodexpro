export function retryAfterSecondsFromFailure(input: {
  status?: number;
  retryAfter?: unknown;
}): number {
  if (input.status !== 429) return 0;
  const value = Number(input.retryAfter);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(3600, Math.floor(value));
}

export function loginCooldownMessage(seconds: number): string {
  const safe = Math.max(1, seconds);
  return `Слишком много попыток входа. Подождите ${safe} сек. / Too many sign-in attempts. Please wait ${safe} seconds.`;
}

export function remainingCooldownSeconds(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

export function offerRecoveryFromFailure(input: { offerRecovery?: unknown }): boolean {
  return input.offerRecovery === true;
}

export function loginChallengeFromResponse(input: {
  required?: unknown;
  command?: unknown;
}): { required: boolean; command: 'verify_mfa' | null } {
  if (input.required !== true) return { required: false, command: null };
  return { required: true, command: input.command === 'verify_mfa' ? 'verify_mfa' : 'verify_mfa' };
}

export function readLoginStamp(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  const existing = storage?.getItem('nx_login_stamp');
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17 + 3) % 256;
  }
  const next = Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('');
  storage?.setItem('nx_login_stamp', next);
  return next;
}
