import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiJson, ApiError } from '../api/client';
import { AUTH } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { supabase } from '../lib/supabase';
import {
  AccountSecuritySection,
  MfaOnboardingPrompt,
  type AccountSecurityFields,
  type MfaEnrollment,
  type MfaPolicyFields,
  type MfaPromptFields,
} from './MfaOnboardingPrompt';
import { englishSecurityText } from './security-copy';
import './account-security-panel.css';

interface MfaAggregate {
  prompt: MfaPromptFields;
  account_security: AccountSecurityFields;
  policy?: MfaPolicyFields;
  this_device?: 'trusted' | 'untrusted' | 'unavailable';
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

function isHebrew(value: string): boolean {
  return /[\u0590-\u05FF]/.test(value);
}

export function AccountSecurityPanel(props: {
  mode: 'prompt' | 'section' | 'both';
  locale?: 'en';
  embedded?: boolean;
}) {
  const location = useLocation();
  const { lang, t } = useI18n();
  const tx = (key: string) => (props.locale === 'en' ? englishSecurityText(key) : t(key));
  const [aggregate, setAggregate] = useState<MfaAggregate | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryGrant, setRecoveryGrant] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const copyLang = props.locale === 'en' ? 'en' : lang;
  const hideGlobalPrompt = props.mode === 'prompt' && location.pathname === '/settings';

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
        if (!cancelled) setError(tx('settings.accountSecurity.mfaLoadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCommand(command: string, body?: Record<string, string>) {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
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
          setError(tx('settings.accountSecurity.mfaSessionUpdateFailed'));
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
          setError(tx('settings.accountSecurity.mfaRecoveryReenrollFailed'));
        });
      }
      if (command === 'trust_mfa_device' || command === 'revoke_trusted_device') {
        await load();
      }
      return result;
    } catch (e) {
      const backendMessage = e instanceof ApiError ? e.message : '';
      const preferEnglish = copyLang !== 'he';
      const message = preferEnglish
        ? (backendMessage && !isHebrew(backendMessage) ? backendMessage : tx('settings.accountSecurity.mfaCommandFailed'))
        : (backendMessage && isHebrew(backendMessage) ? backendMessage : tx('settings.accountSecurity.mfaCommandFailed'));
      setError(message);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onPrompt(command: string, body: { decision: 'accept' | 'decline'; warning_version: string }) {
    const result = await runCommand(command, body);
    if (result?.next_commands?.includes('enroll_mfa')) {
      await runCommand('enroll_mfa');
    }
  }

  const showPrompt = props.mode !== 'section' && !hideGlobalPrompt;
  const showSection = props.mode !== 'prompt';

  if (!aggregate) {
    if (props.mode === 'prompt') return null;
    if (error) return <p role="alert">{error}</p>;
    return <p data-testid="account-security-loading">{tx('settings.accountSecurity.mfaLoading')}</p>;
  }

  if (props.mode === 'prompt' && (!aggregate.prompt.show || hideGlobalPrompt)) return null;

  const section = showSection ? (
    <>
      <AccountSecuritySection
        locale={props.locale}
        busy={busy}
        embedded={props.embedded}
        security={aggregate.account_security}
        enrollment={enrollment}
        policy={aggregate.policy}
        thisDevice={aggregate.this_device}
        onCommand={(command, body) => void runCommand(command, body)}
      />
      {recoveryCodes ? (
        <div data-testid="mfa-recovery-codes">
          <p>{tx('settings.accountSecurity.mfaRecoveryCodesOnce')}</p>
          <ul>
            {recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  ) : null;

  if (props.mode === 'prompt') {
    return (
      <div className="nx-mfa-prompt-overlay" data-testid="account-security-panel">
        <div className="nx-mfa-prompt-overlay__card">
          {error ? <p role="alert">{error}</p> : null}
          {busy ? <p data-testid="account-security-busy">{tx('settings.accountSecurity.mfaWorking')}</p> : null}
          <MfaOnboardingPrompt
            locale={props.locale}
            busy={busy}
            prompt={aggregate.prompt}
            onCommand={(command, body) => void onPrompt(command, body)}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="account-security-panel">
      {error ? <p role="alert">{error}</p> : null}
      {busy ? <p data-testid="account-security-busy">{tx('settings.accountSecurity.mfaWorking')}</p> : null}
      {showPrompt ? (
        <MfaOnboardingPrompt
          locale={props.locale}
          busy={busy}
          prompt={aggregate.prompt}
          onCommand={(command, body) => void onPrompt(command, body)}
        />
      ) : null}
      {section}
    </div>
  );
}
