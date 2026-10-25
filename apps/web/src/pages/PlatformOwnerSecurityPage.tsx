import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  payload?: Record<string, string | number | boolean | null>;
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
  alert_delivery_channel?: {
    channel: 'email';
    configured: boolean;
    destination_status: 'verified' | 'not_configured' | 'unverified';
    destination_masked: string | null;
    provider_status: 'configured' | 'not_configured';
    pending_count: number;
    accepted_count: number;
    failed_count: number;
    recent: Array<{
      id: string;
      event_action: string;
      severity: 'critical' | 'high' | 'medium' | 'low';
      event_kind: 'security' | 'test';
      status: 'pending' | 'processing' | 'accepted' | 'failed';
      attempt_count: number;
      failure_code: string | null;
      created_at: string | null;
      accepted_at: string | null;
    }>;
  };
  geoip_attribution?: {
    text: string;
    url: string;
  };
  delivery_failure_count: number;
  events: SecurityEvent[];
  test_delivery?: { queued: boolean; status: 'accepted' | 'failed' | 'pending'; reason?: string };
  permanent_mfa: PermanentMfaPanel | null;
}

export function PlatformOwnerSecurityPage() {
  const [params, setParams] = useSearchParams();
  const tab = resolveOwnerSecurityTab(params.get('tab'));
  const [data, setData] = useState<SecurityEventsAggregate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [deliveryFilter, setDeliveryFilter] = useState('all');
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void apiJson<SecurityEventsAggregate>(OWNER.securityEvents)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : copy.loadFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
    if (busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function activatePermanently() {
    const panel = data?.permanent_mfa;
    if (!panel?.activate_enabled || busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function verifyRecovery(event: FormEvent) {
    event.preventDefault();
    const panel = data?.permanent_mfa;
    if (!panel?.verify_recovery_enabled || busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  const panel = data?.permanent_mfa;
  const eventTypeOptions = Array.from(new Set((data?.events ?? []).map((event) => event.action)));
  const filteredEvents = (data?.events ?? []).filter((event) => {
    if (severityFilter !== 'all' && event.severity !== severityFilter) return false;
    if (eventFilter !== 'all' && event.action !== eventFilter) return false;
    return true;
  });
  const filteredDeliveries = (data?.alert_delivery_channel?.recent ?? []).filter((delivery) => {
    if (deliveryFilter !== 'all' && delivery.status !== deliveryFilter) return false;
    return true;
  });
  const deliveryLabel = (status: string) => {
    if (status === 'accepted') return copy.deliveryAccepted;
    if (status === 'failed') return copy.deliveryFailed;
    return copy.deliveryPending;
  };
  const payloadText = (event: SecurityEvent, key: string) => {
    const value = event.payload?.[key];
    return typeof value === 'string' && value.trim() ? value : copy.sourceUnknown;
  };

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

      <section data-testid="owner-security-mfa" hidden={tab !== 'mfa'}>
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
                    {busy ? copy.working : copy.verifyRecovery}
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
                  {busy ? copy.activating : copy.activate}
                </button>
              )}
            </section>
          ) : loading ? (
            <p>{copy.enrollLoading}</p>
          ) : null}
      </section>
        <section data-testid="owner-security-alerts" hidden={tab !== 'alerts'}>
          {loading && !data ? <p>{copy.eventsLoading}</p> : null}
          {data ? (
            <>
              <p data-testid="owner-alert-delivery">
                {data.alert_delivery === 'configured' ? copy.alertsConfigured : copy.alertsNotConfigured}
              </p>
              <p>{copy.deliveryFailures(data.window_hours, data.delivery_failure_count)}</p>
              {data.test_delivery ? (
                <p data-testid="owner-alert-test">
                  {data.test_delivery.status === 'accepted'
                    ? copy.testDelivered
                    : copy.testNotDelivered(data.test_delivery.reason)}
                </p>
              ) : null}
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void sendTest()}>
                {busy ? copy.sendingTestAlert : copy.sendTestAlert}
              </button>
              {data.alert_delivery_channel ? (
                <div className="nx-owner-security__delivery">
                  <p>{data.alert_delivery_channel.provider_status === 'configured' ? copy.providerConfigured : copy.providerNotConfigured}</p>
                  <p>
                    {data.alert_delivery_channel.destination_status === 'verified' && data.alert_delivery_channel.destination_masked
                      ? `${copy.destinationVerified}: ${data.alert_delivery_channel.destination_masked}`
                      : copy.destinationUnavailable}
                  </p>
                  <p>
                    {copy.deliveryPending}: {data.alert_delivery_channel.pending_count} · {copy.deliveryAccepted}: {data.alert_delivery_channel.accepted_count} · {copy.deliveryFailed}: {data.alert_delivery_channel.failed_count}
                  </p>
                </div>
              ) : null}
              <div className="nx-owner-security__filters" aria-label="Security alert filters">
                <label>
                  {copy.filterSeverity}
                  <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
                    <option value="all">{copy.filterAll}</option>
                    <option value="critical">{copy.severity.critical}</option>
                    <option value="high">{copy.severity.high}</option>
                    <option value="medium">{copy.severity.medium}</option>
                    <option value="low">{copy.severity.low}</option>
                  </select>
                </label>
                <label>
                  {copy.filterEventType}
                  <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
                    <option value="all">{copy.filterAll}</option>
                    {eventTypeOptions.map((action) => (
                      <option key={action} value={action}>{englishEventAction(action)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {filteredEvents.length === 0 ? <p>{copy.noEvents}</p> : null}
              <ul className="nx-owner-security__events">
                {filteredEvents.map((event) => (
                  <li key={event.id}>
                    <strong>{englishSeverity(event.severity)}</strong> · {englishEventAction(event.action)} · {event.created_at}
                    <br />
                    Source IP: {payloadText(event, 'source_ip')} · Location: {payloadText(event, 'country')}, {payloadText(event, 'city')} · Network: {payloadText(event, 'network')}
                  </li>
                ))}
              </ul>
              {data.alert_delivery_channel?.recent?.length ? (
                <>
                  <h2 className="nx-owner-security__subtitle">{copy.recentDeliveries}</h2>
                  <label className="nx-owner-security__filter-single">
                    {copy.filterDeliveryStatus}
                    <select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)}>
                      <option value="all">{copy.filterAll}</option>
                      <option value="pending">{copy.deliveryPending}</option>
                      <option value="processing">{copy.deliveryPending}</option>
                      <option value="accepted">{copy.deliveryAccepted}</option>
                      <option value="failed">{copy.deliveryFailed}</option>
                    </select>
                  </label>
                  <ul className="nx-owner-security__events">
                    {filteredDeliveries.map((delivery) => (
                      <li key={delivery.id}>
                        {delivery.event_kind === 'test' ? `${copy.testLabel} · ` : null}
                        {englishSeverity(delivery.severity)} · {englishEventAction(delivery.event_action)} · {delivery.created_at ?? copy.sourceUnknown}
                        <br />
                        {deliveryLabel(delivery.status)} · Attempts: {delivery.attempt_count}
                        {delivery.failure_code ? ` · Error: ${delivery.failure_code}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="nx-owner-security__attribution">
                <a href={data.geoip_attribution?.url ?? 'https://db-ip.com/db/download/ip-to-city-lite'} target="_blank" rel="noreferrer">
                  {data.geoip_attribution?.text ?? copy.geoIpAttributionFallback}
                </a>
              </p>
            </>
          ) : null}
        </section>
    </div>
  );
}
