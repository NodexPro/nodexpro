/**
 * Same-browser account switch. Local session only — never revokes other devices.
 */

export function shouldClearLocalSessionBeforePasswordLogin(input: {
  challengeRequired: boolean;
}): boolean {
  return input.challengeRequired !== true;
}

let localPasswordSwitch: { nonce: number; installedUserId: string | null } | null = null;

export function beginLocalPasswordSwitch(): number {
  const nonce = (localPasswordSwitch?.nonce ?? 0) + 1;
  localPasswordSwitch = { nonce, installedUserId: null };
  return nonce;
}

export function noteLocalPasswordSwitchIdentity(userId: string | null | undefined): void {
  if (!localPasswordSwitch) return;
  const id = String(userId ?? '').trim();
  if (id) localPasswordSwitch.installedUserId = id;
}

export function endLocalPasswordSwitch(): void {
  localPasswordSwitch = null;
}

export function localPasswordSwitchInstalledUserId(): string | null {
  return localPasswordSwitch?.installedUserId ?? null;
}

/** Password-login switch must not call Core /logout (that is the explicit Sign out control). */
export function loginSwitchUsesBackendLogout(source: string): boolean {
  return /AUTH\.logout/.test(source);
}

export function loginSwitchSignOutIsLocal(source: string): boolean {
  return /signOut\(deviceSignOutOptions\(\)\)/.test(source) && !/signOut\(\s*\)/.test(source);
}
