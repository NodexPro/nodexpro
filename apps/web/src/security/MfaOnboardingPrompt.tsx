import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

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

export function MfaOnboardingPrompt(props: {
  prompt: MfaPromptFields;
  onCommand: (command: string, body: { decision: 'accept' | 'decline'; warning_version: string }) => void;
}) {
  if (!props.prompt.show) return null;
  return (
    <section aria-labelledby="mfa-prompt-title" data-testid="mfa-onboarding-prompt">
      <h2 id="mfa-prompt-title">{props.prompt.title_he}</h2>
      <p>{props.prompt.body_he}</p>
      <button
        type="button"
        data-testid="mfa-prompt-accept"
        onClick={() =>
          props.onCommand(props.prompt.accept_command, {
            decision: props.prompt.accept_decision,
            warning_version: props.prompt.warning_version,
          })
        }
      >
        {props.prompt.accept_label_he}
      </button>
      {props.prompt.decline_allowed ? (
        <button
          type="button"
          className="secondary"
          data-testid="mfa-prompt-decline"
          onClick={() =>
            props.onCommand(props.prompt.decline_command, {
              decision: props.prompt.decline_decision,
              warning_version: props.prompt.warning_version,
            })
          }
        >
          {props.prompt.decline_label_he}
        </button>
      ) : null}
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
}) {
  const [code, setCode] = useState('');
  const fieldId = props.fieldId ?? 'mfa-recovery-code';
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        props.onCommand(props.command, { recovery_code: code });
      }}
    >
      <label htmlFor={fieldId}>קוד שחזור</label>
      <input
        id={fieldId}
        data-testid={props.testId ?? 'mfa-recovery-code'}
        autoComplete="off"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <button type="submit" className="nx-btn nx-btn-taxes-compact" data-testid={props.testId ? `${props.testId}-submit` : 'mfa-recover'}>{props.label}</button>
    </form>
  );
}

export function AccountSecuritySection(props: {
  security: AccountSecurityFields;
  enrollment: MfaEnrollment | null;
  onCommand: (command: string, body?: Record<string, string>) => void;
}) {
  const [code, setCode] = useState('');
  return (
    <section aria-labelledby="account-security-title" data-testid="account-security-section">
      <h2 id="account-security-title">{props.security.section_he}</h2>
      <p data-testid="account-security-status">{props.security.status_he}</p>
      <p>{props.security.policy_he}</p>
      {props.security.pending_he ? <p data-testid="mfa-pending">{props.security.pending_he}</p> : null}
      {props.security.enroll_enabled ? (
        <button type="button" data-testid="account-security-enroll" onClick={() => props.onCommand(props.security.enroll_command)}>
          {props.security.enroll_label_he}
        </button>
      ) : null}
      {props.enrollment ? (
        <div data-testid="mfa-enrollment">
          <h3>{props.security.qr_title_he}</h3>
          <EnrollmentQr uri={props.enrollment.otpauthUri} />
          <label htmlFor="mfa-code">{props.security.code_label_he}</label>
          <input
            id="mfa-code"
            data-testid="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            type="button"
            data-testid="mfa-verify"
            onClick={() => props.onCommand(props.security.verify_command, { factor_id: props.enrollment!.factorId, code })}
          >
            {props.security.verify_label_he}
          </button>
          <button type="button" className="secondary" data-testid="mfa-cancel" onClick={() => props.onCommand(props.security.cancel_command)}>
            {props.security.cancel_label_he}
          </button>
        </div>
      ) : null}
      {props.security.remove_enabled ? (
        <button type="button" className="secondary" data-testid="mfa-remove" onClick={() => props.onCommand(props.security.remove_command)}>
          {props.security.remove_label_he}
        </button>
      ) : null}
      {props.security.replace_enabled ? (
        <button type="button" data-testid="mfa-replace" onClick={() => props.onCommand(props.security.replace_command)}>
          {props.security.replace_label_he}
        </button>
      ) : null}
      <p data-testid="mfa-recovery-status">{props.security.recovery_unavailable_he}</p>
      {props.security.recovery_issue_enabled && props.security.recovery_issue_command ? (
        <button type="button" data-testid="mfa-issue-recovery" onClick={() => props.onCommand(props.security.recovery_issue_command!)}>
          {props.security.recovery_issue_label_he}
        </button>
      ) : null}
      {props.security.recover_enabled && props.security.recover_command ? (
        <RecoveryCodeForm
          label={props.security.recover_label_he ?? ''}
          command={props.security.recover_command}
          onCommand={props.onCommand}
        />
      ) : null}
      {props.security.recovery_verify_enabled && props.security.recovery_verify_command ? (
        <RecoveryCodeForm
          label={props.security.recovery_verify_label_he ?? ''}
          command={props.security.recovery_verify_command}
          onCommand={props.onCommand}
          fieldId="mfa-recovery-verify-code"
          testId="mfa-recovery-verify"
        />
      ) : null}
      <p data-testid="mfa-trusted-status">{props.security.device_status_he}</p>
      {props.security.trust_enabled ? (
        <button type="button" data-testid="mfa-trust-device" onClick={() => props.onCommand(props.security.trust_command)}>
          {props.security.trust_label_he}
        </button>
      ) : null}
      {props.security.devices.filter((device) => !device.revoked).map((device) => (
        <button
          key={device.id}
          type="button"
          className="secondary"
          data-testid="mfa-revoke-device"
          onClick={() => props.onCommand(device.revoke_command, { device_id: device.id })}
        >
          {device.revoke_label_he}
        </button>
      ))}
      <p data-testid="mfa-suspicious-status">{props.security.suspicious_unavailable_he}</p>
    </section>
  );
}
