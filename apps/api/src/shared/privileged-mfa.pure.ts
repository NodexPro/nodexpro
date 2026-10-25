import {
  decidePrivilegedMfaFromActivation,
  type PrivilegedMfaActivationState,
} from './privileged-mfa-activation.pure.js';

export type AuthenticatorAssurance = 'aal1' | 'aal2';
export type PrivilegedMfaOutcome =
  | { outcome: 'allow' }
  | { outcome: 'allow'; enforcement: 'blocked_recovery_not_ready' }
  | { outcome: 'deny'; code: 'MFA_REQUIRED' };
export type { PrivilegedMfaActivationState };

export function readAuthenticatorAssurance(jwt: string): AuthenticatorAssurance {
  const part = jwt.split('.')[1];
  if (!part) return 'aal1';
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { aal?: unknown };
    return json.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

/** Office owner, office admin, and staff use optional MFA. This never selects the platform-owner gate. */
export function isOfficePrivilegedRole(_roleCode: string | null | undefined): boolean {
  return false;
}

/** Platform owner is the configured identity with no tenant role. Password-recovery OTP is not this check. */
export function isPlatformOwnerSession(input: {
  userEmail: string | null | undefined;
  configuredOwnerEmail: string | null | undefined;
  tenantRoleCode: string | null | undefined;
}): boolean {
  const configured = String(input.configuredOwnerEmail ?? '').trim().toLowerCase();
  const email = String(input.userEmail ?? '').trim().toLowerCase();
  if (!configured || !email || email !== configured) return false;
  return !String(input.tenantRoleCode ?? '').trim();
}

/**
 * Platform-owner lockout only. Migrations 200/201 and env flags do not activate enforcement.
 * Enforcement is on only after persisted PERMANENTLY_ACTIVE state.
 * After activation, unreadability fails closed. aal2 always passes. Office roles are never privileged here.
 */
export function decidePrivilegedMfa(input: {
  activationState?: PrivilegedMfaActivationState;
  enforcementRequested?: boolean;
  recoveryReady?: boolean;
  trustedDevicesReady?: boolean;
  trustedDevice?: boolean;
  assurance: AuthenticatorAssurance;
  privileged: boolean;
  enrollmentRoute: boolean;
  suspiciousSignIn?: boolean;
}): PrivilegedMfaOutcome {
  void input.enforcementRequested;
  void input.recoveryReady;
  void input.trustedDevicesReady;
  void input.trustedDevice;
  return decidePrivilegedMfaFromActivation({
    activationState: input.activationState ?? 'not_activated',
    assurance: input.assurance,
    privileged: input.privileged,
    enrollmentRoute: input.enrollmentRoute,
    suspiciousSignIn: input.suspiciousSignIn,
  });
}
