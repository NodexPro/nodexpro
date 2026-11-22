/** Device logout only. Does not revoke other computers. */
export const DEVICE_SIGNOUT_SCOPE = 'local' as const;

export function deviceSignOutOptions(): { scope: 'local' } {
  return { scope: DEVICE_SIGNOUT_SCOPE };
}
