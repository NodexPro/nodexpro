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
  phase5_status?: 'ready' | 'migration_required';
  containment_enforcement?: 'enabled' | 'disabled';
  edge_protection?: {
    status: 'not_configured' | 'configured_unverified' | 'verified';
    waf_active: boolean;
    covers_web: boolean;
    covers_api: boolean;
  };
  upload_scanning?: { status: 'not_configured' | 'required' | 'optional' | 'unavailable' };
  distributed_rate_limit?: { status: 'enabled' };
  active_incidents?: SecurityIncident[];
  incident_history?: SecurityIncident[];
  delivery_failure_count: number;
  events: SecurityEvent[];
  journal?: {
    groups: JournalGroup[];
    total_groups: number;
    page: number;
    page_size: number;
    filter_options: { severities: string[]; events: string[] };
  };
  allowed_actions?: Array<{ action_key: string; label: string }>;
  test_delivery?: { queued: boolean; status: 'accepted' | 'failed' | 'pending'; reason?: string };
  permanent_mfa: PermanentMfaPanel | null;
}

interface JournalGroup {
  group_key: string;
  action: string;
  severity: string;
  created_at: string;
  display_ip: string;
  country: string;
  city: string;
  attempted_identifier: string | null;
  attempt_count: number;
  detection_reason: string;
  incident_id: string | null;
  cooldown_status: string;
  containment_action: string;
  alert_status: string;
  history: Array<{ id: string; created_at: string; attempt_count: number }>;
}

interface SecurityIncident {
  id: string;
  event_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: 'confirmed' | 'suspicious' | 'benign';
  status: string;
  rule_id: string;
  evidence_summary: string;
  evidence: Record<string, string | number | boolean | null>;
  source_ip: string | null;
  actor_user_id: string | null;
  organization_id: string | null;
  correlation_id: string | null;
  containment_action: string;
  containment_status: string;
  created_at: string;
  released_at: string | null;
  containment_rules: Array<{
    id: string;
    scope: string;
    action: string;
    status: string;
    reason: string;
    starts_at: string;
    expires_at: string;
    released_at: string | null;
  }>;
  allowed_actions: Array<{ action_key: string; label: string }>;
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
  const [ipFilter, setIpFilter] = useState('');
  const [identifierFilter, setIdentifierFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [journalPage, setJournalPage] = useState(1);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const busyRef = useRef(false);

  function journalQuery() {
    const search = new URLSearchParams();
    if (severityFilter !== 'all') search.set('severity', severityFilter);
    if (eventFilter !== 'all') search.set('event', eventFilter);
    if (ipFilter.trim()) search.set('ip', ipFilter.trim());
    if (identifierFilter.trim()) search.set('identifier', identifierFilter.trim());
    if (fromFilter) search.set('from', fromFilter);
    if (toFilter) search.set('to', toFilter);
    if (journalPage > 1) search.set('page', String(journalPage));
    const suffix = search.toString();
    return suffix ? `${OWNER.securityEvents}?${suffix}` : OWNER.securityEvents;
  }

  useEffect(() => {
    let cancelled = false;
    void apiJson<SecurityEventsAggregate>(journalQuery())
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
  }, [severityFilter, eventFilter, ipFilter, identifierFilter, fromFilter, toFilter, journalPage]);

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

  async function clearJournal() {
    if (busyRef.current) return;
    if (!window.confirm(copy.clearJournalConfirm)) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<SecurityEventsAggregate>(OWNER.clearSecurityJournal, {
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

  async function releaseIncident(incidentId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<SecurityEventsAggregate>(OWNER.releaseSecurityContainment, {
        method: 'POST',
        body: JSON.stringify({ incident_id: incidentId, reason: 'Platform Owner manual release' }),
      }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : copy.commandFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function payloadTextFromIncident(incident: SecurityIncident, key: string) {
    const value = incident.evidence?.[key];
    return typeof value === 'string' && value.trim() ? value : copy.sourceUnknown;
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
  const eventTypeOptions = data?.journal?.filter_options.events ?? [];
  const journalGroups = data?.journal?.groups ?? [];
  const filteredDeliveries = (data?.alert_delivery_channel?.recent ?? []).filter((delivery) => {
    if (deliveryFilter !== 'all' && delivery.status !== deliveryFilter) return false;
    return true;
  });
  const deliveryLabel = (status: string) => {
    if (status === 'accepted') return copy.deliveryAccepted;
    if (status === 'failed') return copy.deliveryFailed;
    return copy.deliveryPending;
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
              {data.phase5_status === 'migration_required' ? <p role="status">{copy.phase5MigrationRequired}</p> : null}
              <p data-testid="owner-containment-enforcement">
                {data.containment_enforcement === 'enabled' ? copy.containmentEnforcementOn : copy.containmentEnforcementOff}
              </p>
              <p data-testid="owner-edge-protection">
                {data.edge_protection?.status === 'verified'
                  ? copy.edgeVerified
                  : data.edge_protection?.status === 'configured_unverified'
                    ? copy.edgeConfiguredUnverified
                    : copy.edgeNotConfigured}
              </p>
              <p data-testid="owner-upload-scanning">
                {data.upload_scanning?.status === 'required'
                  ? copy.uploadScanRequired
                  : data.upload_scanning?.status === 'optional'
                    ? copy.uploadScanOptional
                    : copy.uploadScanNotConfigured}
              </p>
              <p data-testid="owner-distributed-rate-limit">{copy.rateLimitEnabled}</p>
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
              <section data-testid="owner-active-security-incidents" className="nx-owner-security__delivery">
                <h2 className="nx-owner-security__subtitle">{copy.activeIncidents}</h2>
                {(data.active_incidents ?? []).length === 0 ? <p>{copy.noActiveIncidents}</p> : null}
                {(data.active_incidents ?? []).map((incident) => (
                  <article key={incident.id} className="nx-owner-security__incident">
                    <strong>{englishSeverity(incident.severity)} · {incident.event_type}</strong>
                    <p>{incident.evidence_summary}</p>
                    <p>Detected: {incident.created_at}</p>
                    <p>Source IP: {incident.source_ip ?? copy.sourceUnknown}</p>
                    <p>Location: {payloadTextFromIncident(incident, 'country')}, {payloadTextFromIncident(incident, 'city')}</p>
                    <p>{copy.containment}: {incident.containment_status} · {incident.containment_action}</p>
                    {incident.containment_rules.map((rule) => (
                      <p key={rule.id}>Rule: {rule.scope} · {rule.action} · expires {rule.expires_at}</p>
                    ))}
                    {incident.allowed_actions.some((action) => action.action_key === 'release_security_containment') ? (
                      <button
                        type="button"
                        className="nx-btn nx-btn-taxes-compact"
                        disabled={busy}
                        onClick={() => void releaseIncident(incident.id)}
                      >
                        {copy.releaseContainment}
                      </button>
                    ) : null}
                  </article>
                ))}
              </section>
              <h2 className="nx-owner-security__subtitle">{copy.journalTitle}</h2>
              <div className="nx-owner-security__filters" aria-label="Security journal filters">
                <label>
                  {copy.filterDateFrom}
                  <input className="nx-owner-calendar__date" type="date" value={fromFilter} onChange={(event) => { setJournalPage(1); setFromFilter(event.target.value); }} />
                </label>
                <label>
                  {copy.filterDateTo}
                  <input className="nx-owner-calendar__date" type="date" value={toFilter} onChange={(event) => { setJournalPage(1); setToFilter(event.target.value); }} />
                </label>
                <label>
                  {copy.filterSeverity}
                  <select value={severityFilter} onChange={(event) => { setJournalPage(1); setSeverityFilter(event.target.value); }}>
                    <option value="all">{copy.filterAll}</option>
                    <option value="critical">{copy.severity.critical}</option>
                    <option value="high">{copy.severity.high}</option>
                    <option value="medium">{copy.severity.medium}</option>
                    <option value="low">{copy.severity.low}</option>
                  </select>
                </label>
                <label>
                  {copy.filterEventType}
                  <select value={eventFilter} onChange={(event) => { setJournalPage(1); setEventFilter(event.target.value); }}>
                    <option value="all">{copy.filterAll}</option>
                    {eventTypeOptions.map((action) => (
                      <option key={action} value={action}>{englishEventAction(action)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.filterIp}
                  <input value={ipFilter} onChange={(event) => { setJournalPage(1); setIpFilter(event.target.value); }} />
                </label>
                <label>
                  {copy.filterAttemptedEmail}
                  <input value={identifierFilter} onChange={(event) => { setJournalPage(1); setIdentifierFilter(event.target.value); }} />
                </label>
              </div>
              {data.allowed_actions?.some((action) => action.action_key === 'clear_security_journal') ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void clearJournal()}>
                  {copy.clearJournal}
                </button>
              ) : null}
              {journalGroups.length === 0 ? <p>{copy.noEvents}</p> : null}
              <ul className="nx-owner-security__events">
                {journalGroups.map((group) => (
                  <li key={group.group_key}>
                    <button
                      type="button"
                      className="nx-owner-security__journal-row"
                      onClick={() => setExpandedGroup(expandedGroup === group.group_key ? null : group.group_key)}
                    >
                      <strong>{englishSeverity(group.severity)}</strong> · {englishEventAction(group.action)} · {group.created_at}
                      <br />
                      {group.country}, {group.city} · {group.display_ip} · {group.attempted_identifier ?? copy.sourceUnknown}
                    </button>
                    {expandedGroup === group.group_key ? (
                      <div className="nx-owner-security__journal-details">
                        <p>{copy.attempts}: {group.attempt_count}</p>
                        <p>{copy.detectionReason}: {group.detection_reason}</p>
                        <p>{copy.relatedIncident}: {group.incident_id ?? copy.sourceUnknown}</p>
                        <p>{copy.cooldownStatus}: {group.cooldown_status}</p>
                        <p>{copy.containment}: {group.containment_action}</p>
                        <p>{copy.alertStatus}: {group.alert_status}</p>
                        <p>{copy.eventHistory}</p>
                        <ul>
                          {group.history.map((item) => (
                            <li key={item.id}>{item.created_at} · {copy.attempts}: {item.attempt_count}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {(data.journal?.total_groups ?? 0) > (data.journal?.page_size ?? 20) ? (
                <div className="nx-owner-security__filters">
                  <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={journalPage <= 1} onClick={() => setJournalPage((page) => Math.max(1, page - 1))}>
                    {copy.previousPage}
                  </button>
                  <span>{copy.pageLabel} {data.journal?.page ?? 1}</span>
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={(data.journal?.page ?? 1) * (data.journal?.page_size ?? 20) >= (data.journal?.total_groups ?? 0)}
                    onClick={() => setJournalPage((page) => page + 1)}
                  >
                    {copy.nextPage}
                  </button>
                </div>
              ) : null}
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
              {(data.incident_history ?? []).length ? (
                <>
                  <h2 className="nx-owner-security__subtitle">{copy.incidentHistory}</h2>
                  <ul className="nx-owner-security__events">
                    {(data.incident_history ?? []).slice(0, 20).map((incident) => (
                      <li key={incident.id}>
                        {englishSeverity(incident.severity)} · {incident.event_type} · {incident.status} · {incident.created_at}
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
