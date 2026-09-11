export const PASSWORD_RECOVERY_FLAG = 'nx_password_recovery';

export function isPasswordRecoveryLocation(search: string, hash: string): boolean {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const hashQuery = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return query.get('type') === 'recovery' || hashQuery.get('type') === 'recovery';
}

export function passwordRecoveryCallbackError(search: string, hash: string): string | null {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const hashQuery = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const description = hashQuery.get('error_description') || query.get('error_description');
  const code = hashQuery.get('error') || query.get('error');
  if (description) return description;
  if (code) return code;
  return null;
}

export function markPasswordRecovery(): void {
  sessionStorage.setItem(PASSWORD_RECOVERY_FLAG, '1');
}

export function clearPasswordRecovery(): void {
  sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG);
}

export function isPasswordRecoveryActive(): boolean {
  return sessionStorage.getItem(PASSWORD_RECOVERY_FLAG) === '1';
}
