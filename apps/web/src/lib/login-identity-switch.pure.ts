/**
 * Same-browser account switch. Local session only — never revokes other devices.
 */

export function shouldClearLocalSessionBeforePasswordLogin(input: {
  challengeRequired: boolean;
}): boolean {
  return input.challengeRequired !== true;
}

/** Password-login switch must not call Core /logout (that is the explicit Sign out control). */
export function loginSwitchUsesBackendLogout(source: string): boolean {
  return /AUTH\.logout/.test(source);
}

export function loginSwitchSignOutIsLocal(source: string): boolean {
  return /signOut\(deviceSignOutOptions\(\)\)/.test(source) && !/signOut\(\s*\)/.test(source);
}
