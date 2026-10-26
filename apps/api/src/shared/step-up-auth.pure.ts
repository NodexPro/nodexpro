export type StepUpCommandClass = 'privileged_owner' | 'membership_write' | 'ordinary';

export function classifySensitiveCommand(path: string): StepUpCommandClass {
  const value = String(path ?? '');
  if (value.includes('/owner/') && /activate_platform_owner_mfa|release_security_containment|revoke_security_sessions/.test(value)) {
    return 'privileged_owner';
  }
  if (/change_user_role|revoke_user_access|close_member|invite/.test(value)) return 'membership_write';
  return 'ordinary';
}

/**
 * Do not force MFA enrollment. Step-up applies only when a factor already exists.
 * Privileged owner continues to use the existing permanent-MFA gate.
 */
export function decideSensitiveCommandStepUp(input: {
  commandClass: StepUpCommandClass;
  assurance: 'aal1' | 'aal2';
  mfaEnrolled: boolean;
}): 'allow' | 'require_aal2' {
  if (input.commandClass === 'ordinary') return 'allow';
  if (input.assurance === 'aal2') return 'allow';
  if (input.commandClass === 'membership_write' && input.mfaEnrolled) return 'require_aal2';
  return 'allow';
}
