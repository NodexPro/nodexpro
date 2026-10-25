import type { PrivilegedMfaActivationState } from './privileged-mfa-activation.pure.js';

let recoveryReady = false;
let trustedDevicesReady = false;
let activationState: PrivilegedMfaActivationState = 'not_activated';

export function setPrivilegedMfaGate(state: {
  recoveryReady: boolean;
  trustedDevicesReady: boolean;
  activationState: PrivilegedMfaActivationState;
}): void {
  recoveryReady = state.recoveryReady;
  trustedDevicesReady = state.trustedDevicesReady;
  activationState = state.activationState;
}

export function getPrivilegedMfaGate(): {
  recoveryReady: boolean;
  trustedDevicesReady: boolean;
  activationState: PrivilegedMfaActivationState;
} {
  return { recoveryReady, trustedDevicesReady, activationState };
}
