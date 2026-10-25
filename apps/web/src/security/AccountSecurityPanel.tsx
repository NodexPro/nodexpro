import { useCallback, useEffect, useState } from 'react';
import { apiJson, ApiError } from '../api/client';
import { AUTH } from '../api/endpoints';
import { supabase } from '../lib/supabase';
import {
  AccountSecuritySection,
  MfaOnboardingPrompt,
  type AccountSecurityFields,
  type MfaEnrollment,
  type MfaPromptFields,
} from './MfaOnboardingPrompt';

interface MfaAggregate {
  prompt: MfaPromptFields;
  account_security: AccountSecurityFields;
}

interface CommandResult {
  message?: string;
  access_token?: string;
  refresh_token?: string;
  factor_id?: string;
  otpauth_uri?: string;
  recovery_codes?: string[];
  recovery_enrollment_grant?: string | null;
  next_commands?: string[];
  aggregate?: MfaAggregate;
}

export function AccountSecurityPanel(props: { mode: 'prompt' | 'section' | 'both' }) {
  const [aggregate, setAggregate] = useState<MfaAggregate | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryGrant, setRecoveryGrant] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const next = await apiJson<MfaAggregate>(AUTH.mfaAggregate, { credentials: 'include' });
    setAggregate(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiJson<MfaAggregate>(AUTH.mfaAggregate, { credentials: 'include' })
      .then((next) => {
        if (!cancelled) setAggregate(next);
      })
      .catch(() => {
        if (!cancelled) setError('לא ניתן לטעון את מצב האימות');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCommand(command: string, body?: Record<string, string>) {
    setError('');
    try {
      const payload = { ...(body ?? {}) };
      if (recoveryGrant && (command === 'enroll_mfa' || command === 'verify_mfa' || command === 'cancel_mfa_enrollment')) {
        payload.recovery_enrollment_grant = recoveryGrant;
      }
      const result = await apiJson<CommandResult>(AUTH.mfaCommand(command), {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (result.access_token && result.refresh_token) {
        const saved = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        if (saved.error) {
          setError('האימות הצליח, אבל הסשן לא עודכן. התנתקו ונכנסו שוב לפני פעולה רגישה.');
        }
      }
      if (result.aggregate) setAggregate(result.aggregate);
      if (result.factor_id && result.otpauth_uri) {
        setEnrollment({ factorId: result.factor_id, otpauthUri: result.otpauth_uri });
      }
      if (Array.isArray(result.recovery_codes) && result.recovery_codes.every((code) => typeof code === 'string')) {
        setRecoveryCodes(result.recovery_codes);
      }
      if (typeof result.recovery_enrollment_grant === 'string' && result.recovery_enrollment_grant) {
        setRecoveryGrant(result.recovery_enrollment_grant);
      }
      if (command === 'cancel_mfa_enrollment' || command === 'verify_mfa' || command === 'remove_mfa_factor' || command === 'recover_mfa' || command === 'verify_mfa_recovery') {
        setEnrollment(null);
      }
      if (command === 'verify_mfa') {
        setRecoveryGrant(null);
      }
      if (command === 'recover_mfa' && result.next_commands?.includes('enroll_mfa')) {
        const grant = typeof result.recovery_enrollment_grant === 'string' ? result.recovery_enrollment_grant : recoveryGrant;
        await apiJson<CommandResult>(AUTH.mfaCommand('enroll_mfa'), {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify(grant ? { recovery_enrollment_grant: grant } : {}),
        }).then((enrolled) => {
          if (enrolled.aggregate) setAggregate(enrolled.aggregate);
          if (enrolled.factor_id && enrolled.otpauth_uri) {
            setEnrollment({ factorId: enrolled.factor_id, otpauthUri: enrolled.otpauth_uri });
          }
        }).catch(() => {
          setError('השחזור הצליח, אבל הרישום מחדש לא התחיל. נסו הפעלה ידנית.');
        });
      }
      if (command === 'trust_mfa_device' || command === 'revoke_trusted_device') {
        await load();
      }
      return result;
    } catch (e) {
      const message = e instanceof ApiError && /[\u0590-\u05FF]/.test(e.message) ? e.message : 'הפעולה נכשלה';
      setError(message);
      return null;
    }
  }

  async function onPrompt(command: string, body: { decision: 'accept' | 'decline'; warning_version: string }) {
    const result = await runCommand(command, body);
    if (result?.next_commands?.includes('enroll_mfa')) {
      await runCommand('enroll_mfa');
    }
  }

  if (!aggregate) {
    return error ? <p role="alert">{error}</p> : null;
  }
  const showPrompt = props.mode !== 'section';
  const showSection = props.mode !== 'prompt';
  if (props.mode === 'prompt' && !aggregate.prompt.show) return null;

  return (
    <div data-testid="account-security-panel">
      {error ? <p role="alert">{error}</p> : null}
      {showPrompt ? <MfaOnboardingPrompt prompt={aggregate.prompt} onCommand={(command, body) => void onPrompt(command, body)} /> : null}
      {showSection ? (
        <>
          <h2>{aggregate.account_security.settings_title_he}</h2>
          <AccountSecuritySection
            security={aggregate.account_security}
            enrollment={enrollment}
            onCommand={(command, body) => void runCommand(command, body)}
          />
          {recoveryCodes ? (
            <div data-testid="mfa-recovery-codes">
              <p>הקודים מוצגים פעם אחת. שמרו אותם מחוץ לדפדפן. כל קוד פועל פעם אחת בלבד.</p>
              <ul>
                {recoveryCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
