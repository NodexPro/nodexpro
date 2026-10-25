import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiJson, ApiError } from '../api/client';
import { OWNER } from '../api/endpoints';
import { AccountSecurityPanel } from '../security/AccountSecurityPanel';
import {
  OWNER_SECURITY_COPY as copy,
  englishEventAction,
  englishSeverity,
  resolveOwnerSecurityTab,
  type OwnerSecurityTab,
} from './owner-security-copy.pure';
import './owner-modules/nx-owner-modules.css';

interface SecurityEvent {
  id: string;
  action: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  created_at: string;
}

interface PermanentMfaPanel {
  enforcement: 'NOT_ACTIVATED' | 'PERMANENTLY_ACTIVE' | 'UNREADABLE';
  enrollment_complete: boolean;
  totp_session_verified: boolean;
  recovery_codes_ready: boolean;
  recovery_procedure_tested: boolean;
  activate_command: 'activate_platform_owner_mfa';
  activate_enabled: boolean;
  activated_at: string | null;
  verify_recovery_command: 'verify_mfa_recovery';
  verify_recovery_enabled: boolean;
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

export function PlatformOwnerSecurityPage() {
  const [params, setParams] = useSearchParams();
  const tab = resolveOwnerSecurityTab(params.get('tab'));
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
        if (!cancelled) setError(e instanceof ApiError ? e.message : copy.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openTab(next: OwnerSecurityTab) {
    const nextParams = new URLSearchParams(params);
    if (next === 'mfa') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  }

  async function sendTest() {
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<SecurityEventsAggregate>(OWNER.deliverSecurityTestAlert, {
        method: 'POST',
        body: JSON.stringify({}),
      }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : copy.commandFailed);
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
      setError(e instanceof ApiError ? e.message : copy.commandFailed);
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
      setError(e instanceof ApiError ? e.message : copy.commandFailed);
    } finally {
      setBusy(false);
    }
  }

  const panel = data?.permanent_mfa;

  return (
    <div className="nx-owner-modules nx-owner-security" data-testid="owner-security-page">
      <h1 className="nx-owner-modules__title">{copy.pageTitle}</h1>
      <div className="nx-owner-security__tabs" role="tablist" aria-label={copy.pageTitle}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mfa'}
          className={`nx-owner-security__tab${tab === 'mfa' ? ' is-active' : ''}`}
          data-testid="owner-security-tab-mfa"
          onClick={() => openTab('mfa')}
        >
          {copy.tabMfa}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'alerts'}
          className={`nx-owner-security__tab${tab === 'alerts' ? ' is-active' : ''}`}
          data-testid="owner-security-tab-alerts"
          onClick={() => openTab('alerts')}
        >
          {copy.tabAlerts}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      {tab === 'mfa' ? (
        <section data-testid="owner-security-mfa">
          <AccountSecurityPanel mode="both" locale="en" />
          {panel ? (
            <section data-testid="owner-permanent-mfa" className="nx-owner-security__block">
              <p data-testid="owner-mfa-enrollment">
                {panel.enrollment_complete ? copy.enrollmentComplete : copy.enrollmentIncomplete}
              </p>
              <p data-testid="owner-mfa-totp">
                {panel.totp_session_verified ? copy.totpVerified : copy.totpRequired}
              </p>
              <p data-testid="owner-mfa-recovery">
                {panel.recovery_codes_ready ? copy.recoveryReady : copy.recoveryMissing}
              </p>
              <p data-testid="owner-mfa-drill">
                {panel.recovery_procedure_tested ? copy.drillDone : copy.drillNeeded}
              </p>
              <p data-testid="owner-mfa-enforcement">
                {panel.enforcement === 'PERMANENTLY_ACTIVE'
                  ? copy.enforcementOn
                  : panel.enforcement === 'UNREADABLE'
                    ? copy.enforcementUnreadable
                    : copy.enforcementOff}
              </p>
              {panel.verify_recovery_enabled ? (
                <form onSubmit={(event) => void verifyRecovery(event)}>
                  <label htmlFor="owner-mfa-recovery-code">{copy.recoveryCodeLabel}</label>
                  <input
                    id="owner-mfa-recovery-code"
                    data-testid="owner-mfa-recovery-code"
                    autoComplete="off"
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value)}
                  />
                  <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
                    {copy.verifyRecovery}
                  </button>
                </form>
              ) : null}
              {panel.enforcement === 'PERMANENTLY_ACTIVE' ? (
                <p data-testid="owner-mfa-active">{copy.active}</p>
              ) : (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  data-testid="owner-mfa-activate"
                  disabled={busy || !panel.activate_enabled}
                  onClick={() => void activatePermanently()}
                >
                  {copy.activate}
                </button>
              )}
            </section>
          ) : null}
        </section>
      ) : (
        <section data-testid="owner-security-alerts">
          {data ? (
            <>
              <p data-testid="owner-alert-delivery">
                {data.alert_delivery === 'configured' ? copy.alertsConfigured : copy.alertsNotConfigured}
              </p>
              <p>{copy.deliveryFailures(data.window_hours, data.delivery_failure_count)}</p>
              {data.test_delivery ? (
                <p data-testid="owner-alert-test">
                  {data.test_delivery.delivered
                    ? copy.testDelivered
                    : copy.testNotDelivered(data.test_delivery.reason)}
                </p>
              ) : null}
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void sendTest()}>
                {copy.sendTestAlert}
              </button>
              {data.events.length === 0 ? <p>{copy.noEvents}</p> : null}
              <ul className="nx-owner-security__events">
                {data.events.map((event) => (
                  <li key={event.id}>
                    {englishSeverity(event.severity)} · {englishEventAction(event.action)} · {event.created_at}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
