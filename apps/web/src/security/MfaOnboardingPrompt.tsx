import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useI18n } from '../i18n/I18nProvider';
import { englishSecurityText } from './security-copy';

/** Renders the backend MFA aggregate. It does not decide who must enroll or which tenant a decision belongs to. */

export interface MfaPromptFields {
  show: boolean;
  warning_version: string;
  title_he: string;
  body_he: string;
  accept_command: string;
  accept_decision: 'accept';
  accept_label_he: string;
  decline_command: string;
  decline_decision: 'decline';
  decline_label_he: string;
  decline_allowed: boolean;
  liability_waiver: false;
}

export interface MfaPolicyFields {
  requirement: 'mandatory' | 'optional';
  enforcement_active: boolean;
}

export interface AccountSecurityFields {
  settings_title_he: string;
  section_he: string;
  status_he: string;
  pending_he: string | null;
  enroll_command: string;
  enroll_label_he: string;
  enroll_enabled: boolean;
  verify_command: string;
  verify_label_he: string;
  cancel_command: string;
  cancel_label_he: string;
  remove_command: string;
  remove_label_he: string;
  remove_enabled: boolean;
  replace_command: string;
  replace_label_he: string;
  replace_enabled: boolean;
  qr_title_he: string;
  code_label_he: string;
  recovery_unavailable_he: string;
  recovery_issue_command?: string;
  recovery_issue_label_he?: string;
  recovery_issue_enabled?: boolean;
  recover_command?: string;
  recover_label_he?: string;
  recover_enabled?: boolean;
  recovery_verify_command?: string;
  recovery_verify_label_he?: string;
  recovery_verify_enabled?: boolean;
  trusted_unavailable_he: string;
  device_status_he: string;
  devices: Array<{ id: string; revoked: boolean; revoke_command: string; revoke_label_he: string }>;
  trust_command: string;
  trust_label_he: string;
  trust_enabled: boolean;
  suspicious_unavailable_he: string;
  policy_he: string;
  liability_waiver: false;
}

export interface MfaEnrollment {
  factorId: string;
  otpauthUri: string;
}

function useSecurityText(localeOverride?: 'en') {
  const { t } = useI18n();
  return (key: string) => (localeOverride === 'en' ? englishSecurityText(key) : t(key));
}

function primaryBtn(embedded: boolean): string {
  return embedded ? 'nx-glass-btn nx-glass-btn--purple' : 'nx-btn nx-btn-taxes-compact';
}

function secondaryBtn(embedded: boolean): string {
  return embedded ? 'nx-glass-btn nx-glass-btn--secondary' : 'nx-btn nx-btn-taxes-compact';
}

export function MfaOnboardingPrompt(props: {
  prompt: MfaPromptFields;
  locale?: 'en';
  busy?: boolean;
  onCommand: (command: string, body: { decision: 'accept' | 'decline'; warning_version: string }) => void;
}) {
  const tx = useSecurityText(props.locale);
  if (!props.prompt.show) return null;
  return (
    <section aria-labelledby="mfa-prompt-title" data-testid="mfa-onboarding-prompt">
      <h2 id="mfa-prompt-title">{tx('settings.accountSecurity.mfaPromptTitle')}</h2>
      <p>{tx('settings.accountSecurity.mfaPromptBody')}</p>
      <div className="nx-mfa-prompt-overlay__actions">
        <button
          type="button"
          className="nx-glass-btn nx-glass-btn--purple"
          data-testid="mfa-prompt-accept"
          disabled={props.busy}
          onClick={() =>
            props.onCommand(props.prompt.accept_command, {
              decision: props.prompt.accept_decision,
              warning_version: props.prompt.warning_version,
            })
          }
        >
          {tx('settings.accountSecurity.mfaPromptAccept')}
        </button>
        {props.prompt.decline_allowed ? (
          <button
            type="button"
            className="nx-glass-btn nx-glass-btn--secondary"
            data-testid="mfa-prompt-decline"
            disabled={props.busy}
            onClick={() =>
              props.onCommand(props.prompt.decline_command, {
                decision: props.prompt.decline_decision,
                warning_version: props.prompt.warning_version,
              })
            }
          >
            {tx('settings.accountSecurity.mfaPromptDecline')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function EnrollmentQr(props: { uri: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(props.uri, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [props.uri]);
  if (!src) return null;
  return <img alt="" src={src} width={220} height={220} data-testid="mfa-qr" />;
}

function RecoveryCodeForm(props: {
  label: string;
  command: string;
  onCommand: (command: string, body?: Record<string, string>) => void;
  fieldId?: string;
  testId?: string;
  locale?: 'en';
  busy?: boolean;
  embedded?: boolean;
}) {
  const tx = useSecurityText(props.locale);
  const [code, setCode] = useState('');
  const fieldId = props.fieldId ?? 'mfa-recovery-code';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onCommand(props.command, { recovery_code: code });
      }}
    >
      <label htmlFor={fieldId}>{tx('settings.accountSecurity.mfaRecoveryCodeLabel')}</label>
      <input
        id={fieldId}
        className={props.embedded ? 'nx-glass-input' : undefined}
        data-testid={props.testId ?? 'mfa-recovery-code'}
        autoComplete="off"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <button
        type="submit"
        className={primaryBtn(Boolean(props.embedded))}
        disabled={props.busy}
        data-testid={props.testId ? `${props.testId}-submit` : 'mfa-recover'}
      >
        {props.label}
      </button>
    </form>
  );
}

function policyText(
  tx: (key: string) => string,
  policy: MfaPolicyFields | undefined,
): string {
  if (policy?.requirement === 'mandatory') {
    return tx(
      policy.enforcement_active
        ? 'settings.accountSecurity.mfaMandatoryActive'
        : 'settings.accountSecurity.mfaMandatoryInactive',
    );
  }
  return tx('settings.accountSecurity.mfaOptional');
}

function deviceText(
  tx: (key: string) => string,
  thisDevice: 'trusted' | 'untrusted' | 'unavailable' | undefined,
  trustedCount: number,
  trustEnabled: boolean,
): string {
  if (thisDevice === 'trusted' || trustedCount > 0) return tx('settings.accountSecurity.mfaDeviceTrusted');
  if (thisDevice === 'untrusted' || trustEnabled) return tx('settings.accountSecurity.mfaDeviceUntrusted');
  return tx('settings.accountSecurity.mfaDeviceUnavailable');
}

export function AccountSecuritySection(props: {
  security: AccountSecurityFields;
  enrollment: MfaEnrollment | null;
  locale?: 'en';
  busy?: boolean;
  embedded?: boolean;
  policy?: MfaPolicyFields;
  thisDevice?: 'trusted' | 'untrusted' | 'unavailable';
  onCommand: (command: string, body?: Record<string, string>) => void;
}) {
  const tx = useSecurityText(props.locale);
  const [code, setCode] = useState('');
  const trustedDevices = props.security.devices.filter((device) => !device.revoked);
  const recoveryReady = Boolean(props.security.recovery_issue_enabled || props.security.recover_enabled);
  const embedded = Boolean(props.embedded);
  return (
    <section
      aria-labelledby={embedded ? 'nx-settings-mfa-label' : 'account-security-title'}
      data-testid="account-security-section"
      className={embedded ? 'nx-settings-mfa' : undefined}
    >
      {embedded ? null : <h2 id="account-security-title">{tx('settings.accountSecurity.mfaSection')}</h2>}
      <p data-testid="account-security-status">
        {tx(props.security.enroll_enabled ? 'settings.accountSecurity.mfaStatusOff' : 'settings.accountSecurity.mfaStatusOn')}
      </p>
      <p>{policyText(tx, props.policy)}</p>
      {props.security.pending_he ? (
        <p data-testid="mfa-pending">{tx('settings.accountSecurity.mfaPending')}</p>
      ) : null}
      {props.security.enroll_enabled ? (
        <button
          type="button"
          className={primaryBtn(embedded)}
          data-testid="account-security-enroll"
          disabled={props.busy}
          onClick={() => props.onCommand(props.security.enroll_command)}
        >
          {tx('settings.accountSecurity.mfaEnroll')}
        </button>
      ) : null}
      {props.enrollment ? (
        <div data-testid="mfa-enrollment">
          <h3>{tx('settings.accountSecurity.mfaQrTitle')}</h3>
          <EnrollmentQr uri={props.enrollment.otpauthUri} />
          <label htmlFor="mfa-code">{tx('settings.accountSecurity.mfaCodeLabel')}</label>
          <input
            id="mfa-code"
            className={embedded ? 'nx-glass-input' : undefined}
            data-testid="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            type="button"
            className={primaryBtn(embedded)}
            data-testid="mfa-verify"
            disabled={props.busy}
            onClick={() => props.onCommand(props.security.verify_command, { factor_id: props.enrollment!.factorId, code })}
          >
            {tx('settings.accountSecurity.mfaVerify')}
          </button>
          <button
            type="button"
            className={secondaryBtn(embedded)}
            data-testid="mfa-cancel"
            disabled={props.busy}
            onClick={() => props.onCommand(props.security.cancel_command)}
          >
            {tx('settings.accountSecurity.mfaCancel')}
          </button>
        </div>
      ) : null}
      {props.security.remove_enabled ? (
        <button
          type="button"
          className={secondaryBtn(embedded)}
          data-testid="mfa-remove"
          disabled={props.busy}
          onClick={() => props.onCommand(props.security.remove_command)}
        >
          {tx('settings.accountSecurity.mfaRemove')}
        </button>
      ) : null}
      {props.security.replace_enabled ? (
        <button
          type="button"
          className={primaryBtn(embedded)}
          data-testid="mfa-replace"
          disabled={props.busy}
          onClick={() => props.onCommand(props.security.replace_command)}
        >
          {tx('settings.accountSecurity.mfaReplace')}
        </button>
      ) : null}
      <p data-testid="mfa-recovery-status">
        {tx(recoveryReady ? 'settings.accountSecurity.mfaRecoveryAvailable' : 'settings.accountSecurity.mfaRecoveryUnavailable')}
      </p>
      {props.security.recovery_issue_enabled && props.security.recovery_issue_command ? (
        <button
          type="button"
          className={primaryBtn(embedded)}
          data-testid="mfa-issue-recovery"
          disabled={props.busy}
          onClick={() => props.onCommand(props.security.recovery_issue_command!)}
        >
          {tx('settings.accountSecurity.mfaIssueRecovery')}
        </button>
      ) : null}
      {props.security.recover_enabled && props.security.recover_command ? (
        <RecoveryCodeForm
          locale={props.locale}
          busy={props.busy}
          embedded={embedded}
          label={tx('settings.accountSecurity.mfaRecover')}
          command={props.security.recover_command}
          onCommand={props.onCommand}
        />
      ) : null}
      {props.security.recovery_verify_enabled && props.security.recovery_verify_command ? (
        <RecoveryCodeForm
          locale={props.locale}
          busy={props.busy}
          embedded={embedded}
          label={tx('settings.accountSecurity.mfaVerifyRecovery')}
          command={props.security.recovery_verify_command}
          onCommand={props.onCommand}
          fieldId="mfa-recovery-verify-code"
          testId="mfa-recovery-verify"
        />
      ) : null}
      <p data-testid="mfa-trusted-status">
        {deviceText(tx, props.thisDevice, trustedDevices.length, props.security.trust_enabled)}
      </p>
      {props.security.trust_enabled ? (
        <button
          type="button"
          className={primaryBtn(embedded)}
          data-testid="mfa-trust-device"
          disabled={props.busy}
          onClick={() => props.onCommand(props.security.trust_command)}
        >
          {tx('settings.accountSecurity.mfaTrustDevice')}
        </button>
      ) : null}
      {trustedDevices.map((device) => (
        <button
          key={device.id}
          type="button"
          className={secondaryBtn(embedded)}
          data-testid="mfa-revoke-device"
          disabled={props.busy}
          onClick={() => props.onCommand(device.revoke_command, { device_id: device.id })}
        >
          {tx('settings.accountSecurity.mfaRevokeDevice')}
        </button>
      ))}
      <p data-testid="mfa-suspicious-status">{tx('settings.accountSecurity.mfaSuspicious')}</p>
    </section>
  );
}
