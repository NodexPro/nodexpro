import { useEffect, useState, type FormEvent } from 'react';
import { apiJson, ApiError } from '../api/client';
import { OWNER } from '../api/endpoints';

interface SecurityEvent {
  id: string;
  action: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  created_at: string;
  organization_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, string | number | boolean | null>;
}

interface PermanentMfaPanel {
  enforcement: 'NOT_ACTIVATED' | 'PERMANENTLY_ACTIVE' | 'UNREADABLE';
  enrollment_complete: boolean;
  totp_session_verified: boolean;
  recovery_codes_ready: boolean;
  recovery_procedure_tested: boolean;
  enrollment_status_he: string;
  totp_status_he: string;
  recovery_status_he: string;
  drill_status_he: string;
  enforcement_status_he: string;
  activate_command: 'activate_platform_owner_mfa';
  activate_enabled: boolean;
  activate_label_he: string;
  active_label_he: string;
  activated_at: string | null;
  verify_recovery_command: 'verify_mfa_recovery';
  verify_recovery_enabled: boolean;
  verify_recovery_label_he: string;
}

interface SecurityEventsAggregate {
  aggregate_key: 'owner_security_events';
  window_hours: number;
  alert_delivery: 'configured' | 'not_configured';
  delivery_failure_count: number;
  events: SecurityEvent[];
  test_delivery?: { delivered: boolean; reason?: string };
  permanent_mfa: PermanentMfaPanel | null;
}

export function OwnerSecurityEventsPanel() {
  const [data, setData] = useState<SecurityEventsAggregate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    void apiJson<SecurityEventsAggregate>(OWNER.securityEvents)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Security events are unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendTest() {
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<SecurityEventsAggregate>(OWNER.deliverSecurityTestAlert, { method: 'POST', body: JSON.stringify({}) }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Security test alert failed');
    } finally {
      setBusy(false);
    }
  }

  async function activatePermanently() {
    const panel = data?.permanent_mfa;
    if (!panel?.activate_enabled) return;
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<SecurityEventsAggregate>(OWNER.activatePlatformOwnerMfa, {
        method: 'POST',
        body: JSON.stringify({ activation_request_id: crypto.randomUUID() }),
      }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'הפעלת MFA נכשלה');
    } finally {
      setBusy(false);
    }
  }

  async function verifyRecovery(event: FormEvent) {
    event.preventDefault();
    const panel = data?.permanent_mfa;
    if (!panel?.verify_recovery_enabled) return;
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<SecurityEventsAggregate>(OWNER.verifyPlatformOwnerMfaRecovery, {
        method: 'POST',
        body: JSON.stringify({ recovery_code: recoveryCode }),
      }));
      setRecoveryCode('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'בדיקת השחזור נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const panel = data?.permanent_mfa;

  return (
    <section data-testid="owner-security-events" style={{ marginTop: 16 }}>
      <h2>אבטחה</h2>
      {error ? <p role="alert">{error}</p> : null}
      {panel ? (
        <section data-testid="owner-permanent-mfa" style={{ marginBottom: 24 }}>
          <p data-testid="owner-mfa-enrollment">{panel.enrollment_status_he}</p>
          <p data-testid="owner-mfa-totp">{panel.totp_status_he}</p>
          <p data-testid="owner-mfa-recovery">{panel.recovery_status_he}</p>
          <p data-testid="owner-mfa-drill">{panel.drill_status_he}</p>
          <p data-testid="owner-mfa-enforcement">{panel.enforcement_status_he}</p>
          {panel.verify_recovery_enabled ? (
            <form onSubmit={(event) => void verifyRecovery(event)}>
              <label htmlFor="owner-mfa-recovery-code">קוד שחזור</label>
              <input
                id="owner-mfa-recovery-code"
                data-testid="owner-mfa-recovery-code"
                autoComplete="off"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
              />
              <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
                {panel.verify_recovery_label_he}
              </button>
            </form>
          ) : null}
          {panel.enforcement === 'PERMANENTLY_ACTIVE' ? (
            <p data-testid="owner-mfa-active">{panel.active_label_he}</p>
          ) : (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              data-testid="owner-mfa-activate"
              disabled={busy || !panel.activate_enabled}
              onClick={() => void activatePermanently()}
            >
              {panel.activate_label_he}
            </button>
          )}
        </section>
      ) : null}
      {data ? (
        <>
          <p data-testid="owner-alert-delivery">
            {data.alert_delivery === 'configured'
              ? 'Alert destination is configured. This screen does not prove that a message arrived.'
              : 'Alert destination is not configured. Security alerts are not being delivered.'}
          </p>
          <p>Delivery failures in the last {data.window_hours} hours: {data.delivery_failure_count}</p>
          {data.test_delivery ? (
            <p data-testid="owner-alert-test">
              {data.test_delivery.delivered
                ? 'Test command was accepted by the destination.'
                : `Test command was not delivered${data.test_delivery.reason ? `: ${data.test_delivery.reason}` : ''}.`}
            </p>
          ) : null}
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void sendTest()}>
            deliver_security_test_alert
          </button>
          <ul>
            {data.events.map((event) => (
              <li key={event.id}>
                {event.severity} · {event.action} · {event.created_at}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
