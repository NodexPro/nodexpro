import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgModulesState, orgModuleActivate, orgModuleDeactivate, orgModuleSelectPlan, orgModuleChangePlan, orgLegalIdentity } from '../api/endpoints';
import { useNavigate } from 'react-router-dom';

interface ModulePlanLimitDto {
  limitCode: string;
  limitValue: number | null;
  isUnlimited: boolean;
}

interface ModulePlanItemDto {
  id: string;
  code: string;
  name: string;
  billingPeriod: string;
  currency: string;
  priceAmount: number;
  sortOrder: number;
  limits: ModulePlanLimitDto[];
}

interface ModuleSubscriptionItemDto {
  id: string;
  modulePlanId: string;
  planName: string;
  currency: string;
  priceAmount: number;
  status: string;
  startedAt: string;
  endsAt: string | null;
}

interface ModuleStateItem {
  moduleId: string;
  code: string;
  name: string;
  version: string;
  scopeType: string;
  category: string | null;
  dependencies: string[];
  entitlementStatus: string;
  activationStatus: string;
  canActivate: boolean;
  canDeactivate: boolean;
  blockReason: string | null;
  navPath: string | null;
  navLabel: string | null;
  navOrder: number;
  isSystem: boolean;
  availablePlans: ModulePlanItemDto[];
  currentSubscription: ModuleSubscriptionItemDto | null;
  canSelectPlan: boolean;
  canChangePlan: boolean;
}

interface TrialStateDto {
  hasLegalIdentity: boolean;
  trialStatus: 'none' | 'not_started' | 'trialing' | 'trial_expired' | 'converted' | 'blocked';
  startedAt: string | null;
  endsAt: string | null;
  blocked: boolean;
}

const limitLabel: Record<string, string> = {
  max_clients: 'clients',
  max_companies: 'companies',
  max_employees_per_company: 'employees per company',
};

function formatLimit(l: ModulePlanLimitDto): string {
  const label = limitLabel[l.limitCode] ?? l.limitCode.replace(/_/g, ' ');
  if (l.isUnlimited) return `Unlimited ${label}`;
  if (l.limitValue != null) return `Up to ${l.limitValue} ${label}`;
  return label;
}

function formatBillingPeriod(p: string): string {
  return p === 'year' ? '/ year' : '/ month';
}

const styles = {
  page: { maxWidth: 960, margin: '0 auto', padding: '24px 16px' },
  title: { fontSize: '1.5rem', fontWeight: 700, marginBottom: 8, color: '#1a1a1a' },
  subtitle: { fontSize: '0.875rem', color: '#666', marginBottom: 24 },
  error: { padding: '12px 16px', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 },
  loading: { padding: 24, textAlign: 'center' as const, color: '#666' },
  sectionTitle: { fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  sectionCards: { display: 'flex' as const, flexDirection: 'column' as const, gap: 12 },
  systemCard: {
    padding: '16px 20px',
    background: '#f3f4f6',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    opacity: 0.95,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 12,
  },
  systemName: { fontSize: '1rem', fontWeight: 500, color: '#6b7280' },
  systemCode: { fontSize: '0.8125rem', color: '#9ca3af', fontFamily: 'monospace' },
  systemBadge: { fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', background: '#e5e7eb', padding: '4px 10px', borderRadius: 6 },
  commercialCard: {
    padding: 24,
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  commercialHeader: { marginBottom: 16 },
  commercialName: { fontSize: '1.25rem', fontWeight: 600, color: '#111827', marginBottom: 4 },
  commercialCode: { fontSize: '0.8125rem', color: '#6b7280', fontFamily: 'monospace' },
  statusRow: { display: 'flex', flexWrap: 'wrap' as const, gap: '16px 24px', marginBottom: 20, padding: '12px 0', borderBottom: '1px solid #f3f4f6' },
  statusItem: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  statusLabel: { fontSize: '0.6875rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as const },
  statusValue: { fontSize: '0.875rem', fontWeight: 500, color: '#374151' },
  statusActive: { color: '#059669' },
  statusInactive: { color: '#6b7280' },
  currentPlanBox: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 20 },
  currentPlanLabel: { fontSize: '0.75rem', fontWeight: 600, color: '#166534', marginBottom: 4 },
  currentPlanText: { fontSize: '0.9375rem', fontWeight: 500, color: '#15803d' },
  plansTitle: { fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: 12 },
  plansGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 },
  planCard: {
    padding: 14,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fafafa',
  },
  planName: { fontSize: '0.875rem', fontWeight: 600, color: '#111827', marginBottom: 6 },
  planPrice: { fontSize: '1rem', fontWeight: 700, color: '#059669', marginBottom: 4 },
  planPeriod: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 8 },
  planLimits: { fontSize: '0.8125rem', color: '#4b5563', lineHeight: 1.4 },
  planLimitItem: { marginBottom: 2 },
  actionsRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 10, marginTop: 20, paddingTop: 20, borderTop: '1px solid #f3f4f6' },
  btn: {
    padding: '10px 18px',
    fontSize: '0.875rem',
    fontWeight: 600,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  btnPrimary: { background: '#059669', color: '#fff' },
  btnSecondary: { background: '#e5e7eb', color: '#374151' },
  btnDanger: { background: '#fef2f2', color: '#b91c1c' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' as const },
  blockReason: { fontSize: '0.8125rem', color: '#b45309', marginBottom: 10 },
  select: { padding: '8px 12px', fontSize: '0.875rem', borderRadius: 8, border: '1px solid #d1d5db', minWidth: 200 },
  sectionGap: { marginTop: 32 },
  trialBanner: { padding: '14px 20px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, marginBottom: 20, color: '#065f46', fontSize: '0.9375rem' },
  trialEnded: { padding: '14px 20px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, marginBottom: 20, color: '#92400e', fontSize: '0.9375rem' },
  trialBlocked: { padding: '14px 20px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, marginBottom: 20, color: '#991b1b', fontSize: '0.9375rem' },
};

export function Modules() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<ModuleStateItem[]>([]);
  const [trialState, setTrialState] = useState<TrialStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [planAction, setPlanAction] = useState<{ moduleId: string; kind: 'select' | 'change' } | null>(null);
  const [legalIdentityLoading, setLegalIdentityLoading] = useState(false);
  const [legalIdentityValue, setLegalIdentityValue] = useState('');

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const load = () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    apiJson<{ trialState: TrialStateDto; modules: ModuleStateItem[] }>(orgModulesState(orgId))
      .then((res) => {
        setTrialState(res.trialState);
        setState(res.modules);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [orgId]);

  const handleActivate = async (moduleId: string) => {
    if (!orgId) return;
    setActionLoading(moduleId);
    try {
      await apiJson(orgModuleActivate(orgId, moduleId), { method: 'POST', body: '{}' });
      await auth.refetchMe();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activate failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeactivate = async (moduleId: string) => {
    if (!orgId) return;
    setActionLoading(moduleId);
    try {
      await apiJson(orgModuleDeactivate(orgId, moduleId), { method: 'POST', body: '{}' });
      await auth.refetchMe();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deactivate failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSelectPlan = async (moduleId: string, modulePlanId: string) => {
    if (!orgId) return;
    setActionLoading(moduleId);
    setPlanAction(null);
    try {
      await apiJson(orgModuleSelectPlan(orgId, moduleId), {
        method: 'POST',
        body: JSON.stringify({ modulePlanId }),
      });
      await auth.refetchMe();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Select plan failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePlan = async (moduleId: string, modulePlanId: string) => {
    if (!orgId) return;
    setActionLoading(moduleId);
    setPlanAction(null);
    try {
      await apiJson(orgModuleChangePlan(orgId, moduleId), {
        method: 'POST',
        body: JSON.stringify({ modulePlanId }),
      });
      await auth.refetchMe();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Change plan failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetLegalIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !legalIdentityValue.trim()) return;
    setLegalIdentityLoading(true);
    setError('');
    try {
      await apiJson(orgLegalIdentity(orgId), {
        method: 'POST',
        body: JSON.stringify({
          countryCode: 'IL',
          legalIdentityType: 'tz',
          value: legalIdentityValue.trim(),
        }),
      });
      setLegalIdentityValue('');
      await auth.refetchMe();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set legal identity');
    } finally {
      setLegalIdentityLoading(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p>Select an organization.</p>;

  // System modules are hidden from normal users (internal platform only).
  // Backend still returns them; we only display commercial modules here.
  const commercialModules = state.filter((m) => !m.isSystem);

  const trialActive = trialState?.trialStatus === 'trialing';
  const trialEnded = trialState?.trialStatus === 'trial_expired';
  const trialBlocked = trialState?.blocked === true;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Module catalog</h1>
      <p style={styles.subtitle}>Choose a plan and activate the modules you need. Trial gives full access to all commercial modules.</p>
      {trialActive && (
        <div style={styles.trialBanner}>
          <strong>Free trial active</strong>
          {trialState.endsAt && (
            <span style={{ marginLeft: 8 }}>— Ends {new Date(trialState.endsAt).toLocaleDateString()}. All commercial modules available during trial.</span>
          )}
        </div>
      )}
      {trialEnded && !trialActive && (
        <div style={styles.trialEnded}>
          <strong>Trial ended.</strong> Choose and pay for modules to continue using them.
        </div>
      )}
      {trialBlocked && (
        <div style={styles.trialBlocked}>
          Trial is not available for this organization.
        </div>
      )}
      {!trialState?.hasLegalIdentity && !trialBlocked && trialState !== null && (
        <form onSubmit={handleSetLegalIdentity} style={{ marginBottom: 20, padding: 16, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8 }}>Start free trial</div>
          <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: 12 }}>Set legal identity (Israel teudat zehut, 9 digits) to start a 2‑month free trial for all commercial modules.</p>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Teudat zehut (9 digits)"
            value={legalIdentityValue}
            onChange={(e) => setLegalIdentityValue(e.target.value.replace(/\D/g, '').slice(0, 9))}
            style={{ padding: '8px 12px', marginRight: 8, width: 180, borderRadius: 8, border: '1px solid #d1d5db' }}
          />
          <button type="submit" disabled={legalIdentityLoading || legalIdentityValue.length !== 9} style={{ ...styles.btn, ...styles.btnPrimary }}>
            {legalIdentityLoading ? '…' : 'Start free trial'}
          </button>
        </form>
      )}
      {error && <div style={styles.error}>{error}</div>}
      {loading ? (
        <div style={styles.loading}>Loading modules…</div>
      ) : (
        <>
          {/* Commercial modules only; system modules are internal and not shown to normal users. */}
          <section style={styles.sectionGap}>
            <h2 style={styles.sectionTitle}>Modules</h2>
            <div style={styles.sectionCards}>
              {commercialModules.map((m) => (
                <div key={m.moduleId} style={styles.commercialCard}>
                  <div style={styles.commercialHeader}>
                    <div style={styles.commercialName}>{m.name}</div>
                    <div style={styles.commercialCode}>{m.code}</div>
                    <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: 6 }}>
                      Version {m.version} · Scope: {m.scopeType}
                      {m.dependencies.length > 0 && ` · Dependencies: ${m.dependencies.join(', ')}`}
                    </div>
                  </div>

                  <div style={styles.statusRow}>
                    <div style={styles.statusItem}>
                      <span style={styles.statusLabel}>Entitlement</span>
                      <span style={{ ...styles.statusValue, ...(m.entitlementStatus === 'entitled' || m.entitlementStatus === 'trial' ? styles.statusActive : styles.statusInactive) }}>
                        {m.entitlementStatus}
                      </span>
                    </div>
                    <div style={styles.statusItem}>
                      <span style={styles.statusLabel}>Activation</span>
                      <span style={{ ...styles.statusValue, ...(m.activationStatus === 'active' ? styles.statusActive : styles.statusInactive) }}>
                        {m.activationStatus}
                      </span>
                    </div>
                    {m.currentSubscription && (
                      <div style={styles.statusItem}>
                        <span style={styles.statusLabel}>Subscription</span>
                        <span style={styles.statusValue}>
                          {m.currentSubscription.planName} · {m.currentSubscription.status}
                        </span>
                      </div>
                    )}
                  </div>

                  {m.currentSubscription && (
                    <div style={styles.currentPlanBox}>
                      <div style={styles.currentPlanLabel}>Current plan</div>
                      <div style={styles.currentPlanText}>
                        {m.currentSubscription.planName} — {m.currentSubscription.currency} {m.currentSubscription.priceAmount}
                        {formatBillingPeriod('month')}
                      </div>
                    </div>
                  )}

                  {m.blockReason && <div style={styles.blockReason}>{m.blockReason}</div>}

                  {m.availablePlans.length > 0 && (
                    <>
                      <div style={styles.plansTitle}>Available plans</div>
                      <div style={styles.plansGrid}>
                        {m.availablePlans.map((p) => (
                          <div key={p.id} style={styles.planCard}>
                            <div style={styles.planName}>{p.name}</div>
                            <div style={styles.planPrice}>
                              {p.currency} {p.priceAmount}
                            </div>
                            <div style={styles.planPeriod}>{p.billingPeriod === 'year' ? 'per year' : 'per month'}</div>
                            {p.limits.length > 0 && (
                              <div style={styles.planLimits}>
                                {p.limits.map((l, i) => (
                                  <div key={i} style={styles.planLimitItem}>
                                    {formatLimit(l)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={styles.actionsRow}>
                    {m.canSelectPlan && m.availablePlans.length > 0 && (
                      <>
                        {planAction?.moduleId === m.moduleId && planAction?.kind === 'select' ? (
                          <select
                            style={styles.select}
                            onChange={(e) => {
                              const id = e.target.value;
                              if (id) handleSelectPlan(m.moduleId, id);
                            }}
                            onBlur={() => setPlanAction(null)}
                            autoFocus
                          >
                            <option value="">Choose plan…</option>
                            {m.availablePlans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {p.currency} {p.priceAmount}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            style={{ ...styles.btn, ...styles.btnPrimary, ...(actionLoading ? styles.btnDisabled : {}) }}
                            disabled={!!actionLoading}
                            onClick={() => setPlanAction({ moduleId: m.moduleId, kind: 'select' })}
                          >
                            Select plan
                          </button>
                        )}
                      </>
                    )}
                    {m.canChangePlan && m.availablePlans.length > 1 && (
                      <>
                        {planAction?.moduleId === m.moduleId && planAction?.kind === 'change' ? (
                          <select
                            style={styles.select}
                            onChange={(e) => {
                              const id = e.target.value;
                              if (id) handleChangePlan(m.moduleId, id);
                            }}
                            onBlur={() => setPlanAction(null)}
                            autoFocus
                          >
                            <option value="">Change to…</option>
                            {m.availablePlans.map((p) => (
                              <option key={p.id} value={p.id} disabled={p.id === m.currentSubscription?.modulePlanId}>
                                {p.name} — {p.currency} {p.priceAmount}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            style={{ ...styles.btn, ...styles.btnSecondary, ...(actionLoading ? styles.btnDisabled : {}) }}
                            disabled={!!actionLoading}
                            onClick={() => setPlanAction({ moduleId: m.moduleId, kind: 'change' })}
                          >
                            Change plan
                          </button>
                        )}
                      </>
                    )}
                    {m.canActivate && (
                      <button
                        type="button"
                        style={{ ...styles.btn, ...styles.btnPrimary, ...(actionLoading ? styles.btnDisabled : {}) }}
                        disabled={!!actionLoading}
                        onClick={() => handleActivate(m.moduleId)}
                      >
                        {actionLoading === m.moduleId ? '…' : 'Activate'}
                      </button>
                    )}
                    {m.canDeactivate && (
                      <button
                        type="button"
                        style={{ ...styles.btn, ...styles.btnDanger, ...(actionLoading ? styles.btnDisabled : {}) }}
                        disabled={!!actionLoading}
                        onClick={() => handleDeactivate(m.moduleId)}
                      >
                        {actionLoading === m.moduleId ? '…' : 'Deactivate'}
                      </button>
                    )}
                    {(m.activationStatus === 'active' &&
                      (m.navPath || m.code === 'client-operations' || m.code === 'docflow')) && (
                      <button
                        type="button"
                        style={{ ...styles.btn, ...styles.btnSecondary }}
                        onClick={() => {
                          if (m.code === 'docflow') navigate('/m/docflow/invites');
                          else if (m.navPath) navigate(m.navPath as string);
                          else navigate('/m/client-operations');
                        }}
                      >
                        Open
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
