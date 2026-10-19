import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgModulesState, orgModuleActivate, orgModuleDeactivate, orgLegalIdentity } from '../api/endpoints';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { GlassModal } from '../components/glass/GlassModal';
import {
  commercialModules,
  matchingPlan,
  type OfficeModulePlan,
  type OfficeModuleStateItem,
  type OfficeModulesState,
  type OfficeTrialState,
} from '../modules/office-modules-state';
import '../styles/nx-glass-surface.css';

function formatLimit(
  limit: OfficeModulePlan['limits'][number],
  t: (key: string) => string,
): string {
  const known: Record<string, string> = {
    max_clients: t('modules.limits.max_clients'),
    max_companies: t('modules.limits.max_companies'),
    max_employees_per_company: t('modules.limits.max_employees_per_company'),
  };
  const label = known[limit.limitCode] ?? limit.limitCode.replace(/_/g, ' ');
  if (limit.isUnlimited) return `${t('modules.limits.unlimitedPrefix')} ${label}`;
  if (limit.limitValue != null) return `${t('modules.limits.upToPrefix')} ${limit.limitValue} ${label}`;
  return label;
}

function formatBillingPeriod(period: string, t: (key: string) => string): string {
  if (period === 'year') return t('modules.periodYear');
  if (period === 'month') return t('modules.periodMonth');
  return period;
}

function statusLabel(prefix: string, value: string, t: (key: string) => string): string {
  const key = `${prefix}.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

export function Modules() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [state, setState] = useState<OfficeModuleStateItem[]>([]);
  const [trialState, setTrialState] = useState<OfficeTrialState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [legalIdentityLoading, setLegalIdentityLoading] = useState(false);
  const [legalIdentityValue, setLegalIdentityValue] = useState('');

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const canAdministerModules =
    auth.status === 'authenticated' &&
    Array.isArray(auth.me.available_actions) &&
    auth.me.available_actions.includes('module_administration');

  const load = (signal?: AbortSignal) => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    apiJson<OfficeModulesState>(orgModulesState(orgId), { signal })
      .then((res) => {
        if (signal?.aborted) return;
        setTrialState(res.trialState);
        setState(res.modules);
      })
      .catch((e) => {
        if (signal?.aborted || (e as Error)?.name === 'AbortError') return;
        setError(e.message);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  };

  useEffect(() => {
    if (!orgId) return;
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [orgId]);

  const handleActivate = async (moduleId: string) => {
    if (!orgId) return;
    setActionLoading(moduleId);
    try {
      await apiJson(orgModuleActivate(orgId, moduleId), { method: 'POST', body: '{}' });
      await auth.refetchMe();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('modules.errors.activateFailed'));
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
      setError(e instanceof Error ? e.message : t('modules.errors.deactivateFailed'));
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
      setError(err instanceof Error ? err.message : t('modules.errors.legalIdentityFailed'));
    } finally {
      setLegalIdentityLoading(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-glass-page">{t('topBar.selectOrg')}</p>;

  const catalog = commercialModules(state);
  const selected = catalog.find((module) => module.moduleId === selectedModuleId) ?? null;
  const selectedPlan: OfficeModulePlan | null = selected
    ? matchingPlan(selected) ?? selected.availablePlans[0] ?? null
    : null;

  const trialActive = trialState?.trialStatus === 'trialing';
  const trialEnded = trialState?.trialStatus === 'trial_expired';
  const trialBlocked = trialState?.blocked === true;

  return (
    <div className="nx-glass-page nx-glass-page--wide" data-testid="nx-modules">
      <h1 className="nx-glass-title">{t('modules.title')}</h1>
      {canAdministerModules && <p className="nx-glass-subtitle">{t('modules.subtitle')}</p>}
      {canAdministerModules && trialActive && (
        <div className="nx-glass-alert nx-glass-alert--ok">
          <strong>{t('modules.trialActive')}</strong>
          {trialState.endsAt && (
            <span>
              {' '}
              — {t('modules.trialEnds')} {new Date(trialState.endsAt).toLocaleDateString()}. {t('modules.trialAllModules')}
            </span>
          )}
        </div>
      )}
      {canAdministerModules && trialEnded && !trialActive && (
        <div className="nx-glass-alert nx-glass-alert--warn">
          <strong>{t('modules.trialEnded')}</strong> {t('modules.trialEndedHint')}
        </div>
      )}
      {canAdministerModules && trialBlocked && (
        <div className="nx-glass-alert nx-glass-alert--error">{t('modules.trialBlocked')}</div>
      )}
      {canAdministerModules && !trialState?.hasLegalIdentity && !trialBlocked && trialState !== null && (
        <form className="nx-glass-card" onSubmit={handleSetLegalIdentity}>
          <h2>{t('modules.startTrial')}</h2>
          <p className="nx-glass-muted">{t('modules.startTrialHint')}</p>
          <div className="nx-glass-toolbar" style={{ marginBottom: 0 }}>
            <input
              type="text"
              className="nx-glass-input nx-glass-input--inline"
              inputMode="numeric"
              placeholder={t('modules.tzPlaceholder')}
              value={legalIdentityValue}
              onChange={(e) => setLegalIdentityValue(e.target.value.replace(/\D/g, '').slice(0, 9))}
              aria-label={t('modules.tzPlaceholder')}
            />
            <button
              type="submit"
              className="nx-glass-btn nx-glass-btn--purple"
              disabled={legalIdentityLoading || legalIdentityValue.length !== 9}
            >
              {legalIdentityLoading ? t('common.loading') : t('modules.startTrial')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="nx-glass-muted">{t('modules.loading')}</div>
      ) : (
        <section>
          <h2 className="nx-glass-title" style={{ fontSize: 15 }}>
            {t('modules.section')}
          </h2>
          <div className="nx-modules-stack">
            {catalog.map((m) => (
              <div key={m.moduleId} className="nx-glass-card">
                <div>
                  <div className="nx-glass-title" style={{ fontSize: 18, marginBottom: 4 }}>
                    {m.name}
                  </div>
                  <div className="nx-glass-code">{m.code}</div>
                  <p className="nx-glass-muted">{t('modules.descriptionUnavailable')}</p>
                  <div className="nx-glass-meta">
                    {t('modules.version')} {m.version} · {t('modules.scope')}: {m.scopeType}
                    {m.dependencies.length > 0 && ` · ${t('modules.dependencies')}: ${m.dependencies.join(', ')}`}
                  </div>
                </div>

                <div className="nx-glass-status-row">
                  <div className="nx-glass-status-item">
                    <span>{t('modules.entitlement')}</span>
                    <span
                      className={
                        m.entitlementStatus === 'entitled' || m.entitlementStatus === 'trial'
                          ? 'nx-glass-status--active'
                          : 'nx-glass-status--muted'
                      }
                    >
                      {statusLabel('modules.entitlementStatus', m.entitlementStatus, t)}
                    </span>
                  </div>
                  <div className="nx-glass-status-item">
                    <span>{t('modules.activation')}</span>
                    <span className={m.activationStatus === 'active' ? 'nx-glass-status--active' : 'nx-glass-status--muted'}>
                      {statusLabel('modules.activationStatus', m.activationStatus, t)}
                    </span>
                  </div>
                  {m.currentSubscription && (
                    <div className="nx-glass-status-item">
                      <span>{t('modules.subscription')}</span>
                      <span className="nx-glass-status--muted">
                        {m.currentSubscription.planName} · {m.currentSubscription.status}
                      </span>
                    </div>
                  )}
                </div>

                {m.currentSubscription && (
                  <div className="nx-modules-current">
                    <div className="nx-glass-muted">{t('modules.currentPlan')}</div>
                    <div className="nx-glass-plan__price">
                      {m.currentSubscription.planName} — {m.currentSubscription.currency} {m.currentSubscription.priceAmount}
                      {matchingPlan(m)?.billingPeriod
                        ? ` ${formatBillingPeriod(matchingPlan(m)!.billingPeriod, t)}`
                        : ''}
                    </div>
                  </div>
                )}

                {m.blockReason && <div className="nx-glass-alert nx-glass-alert--warn">{m.blockReason}</div>}

                {m.availablePlans.length > 0 && (
                  <>
                    <div className="nx-glass-muted" style={{ marginBottom: 12, fontWeight: 600 }}>
                      {t('modules.availablePlans')}
                    </div>
                    <div className="nx-glass-plans">
                      {m.availablePlans.map((p) => (
                        <div key={p.id} className="nx-glass-plan">
                          <div className="nx-glass-plan__name">{p.name}</div>
                          <div className="nx-glass-plan__price">
                            {p.currency} {p.priceAmount}
                          </div>
                          <div className="nx-glass-muted">{formatBillingPeriod(p.billingPeriod, t)}</div>
                          {p.limits.length > 0 && (
                            <div className="nx-glass-meta">
                              {p.limits.map((l, i) => (
                                <div key={i}>{formatLimit(l, t)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="nx-glass-actions">
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--purple"
                    onClick={() => setSelectedModuleId(m.moduleId)}
                  >
                    {t('modules.select')}
                  </button>
                  {m.canActivate && (
                    <button
                      type="button"
                      className="nx-glass-btn nx-glass-btn--purple"
                      disabled={!!actionLoading}
                      onClick={() => handleActivate(m.moduleId)}
                    >
                      {actionLoading === m.moduleId ? t('common.loading') : t('modules.activate')}
                    </button>
                  )}
                  {m.canDeactivate && (
                    <button
                      type="button"
                      className="nx-glass-btn nx-glass-btn--danger"
                      disabled={!!actionLoading}
                      onClick={() => handleDeactivate(m.moduleId)}
                    >
                      {actionLoading === m.moduleId ? t('common.loading') : t('modules.deactivate')}
                    </button>
                  )}
                  {m.activationStatus === 'active' &&
                    (m.navPath || m.code === 'client-operations' || m.code === 'docflow') && (
                      <button
                        type="button"
                        className="nx-glass-btn nx-glass-btn--secondary"
                        onClick={() => {
                          if (m.code === 'docflow') navigate('/m/docflow/invites');
                          else if (m.navPath) navigate(m.navPath);
                          else navigate('/m/client-operations');
                        }}
                      >
                        {t('modules.open')}
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <GlassModal
        open={selected != null}
        title={selected?.name ?? t('modules.select')}
        onClose={() => setSelectedModuleId(null)}
        testId="nx-modules-select-modal"
        footer={
          selected ? (
            <>
              {selected.canActivate ? (
                <button
                  type="button"
                  className="nx-glass-btn nx-glass-btn--purple"
                  disabled={!!actionLoading}
                  onClick={() => handleActivate(selected.moduleId)}
                >
                  {actionLoading === selected.moduleId ? t('common.loading') : t('modules.activate')}
                </button>
              ) : null}
              {selected.canDeactivate ? (
                <button
                  type="button"
                  className="nx-glass-btn nx-glass-btn--danger"
                  disabled={!!actionLoading}
                  onClick={() => handleDeactivate(selected.moduleId)}
                >
                  {actionLoading === selected.moduleId ? t('common.loading') : t('modules.deactivate')}
                </button>
              ) : null}
              <button type="button" className="nx-glass-btn nx-glass-btn--purple" disabled>
                {t('modules.checkoutUnavailableAction')}
              </button>
              <button type="button" className="nx-glass-btn nx-glass-btn--secondary" onClick={() => setSelectedModuleId(null)}>
                {t('common.close')}
              </button>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <p className="nx-glass-muted">{t('modules.descriptionUnavailable')}</p>
            <dl className="nx-glass-dl">
              <dt>{t('modules.price')}</dt>
              <dd>
                {selectedPlan
                  ? `${selectedPlan.currency} ${selectedPlan.priceAmount}`
                  : selected.currentSubscription
                    ? `${selected.currentSubscription.currency} ${selected.currentSubscription.priceAmount}`
                    : t('common.unavailable')}
              </dd>
              <dt>{t('billing.interval')}</dt>
              <dd>{selectedPlan ? formatBillingPeriod(selectedPlan.billingPeriod, t) : t('common.unavailable')}</dd>
              <dt>{t('billing.tax')}</dt>
              <dd>{t('billing.taxUnavailable')}</dd>
              <dt>{t('modules.entitlement')}</dt>
              <dd>{statusLabel('modules.entitlementStatus', selected.entitlementStatus, t)}</dd>
              <dt>{t('modules.activation')}</dt>
              <dd>{statusLabel('modules.activationStatus', selected.activationStatus, t)}</dd>
              <dt>{t('modules.prerequisites')}</dt>
              <dd>
                {selected.dependencies.length > 0 ? selected.dependencies.join(', ') : t('modules.noPrerequisites')}
              </dd>
            </dl>
            {selected.blockReason ? <div className="nx-glass-alert nx-glass-alert--warn">{selected.blockReason}</div> : null}
            <p className="nx-glass-alert nx-glass-alert--warn">{t('modules.checkoutUnavailable')}</p>
            <p className="nx-glass-muted">{t('modules.checkoutTerms')}</p>
          </>
        ) : null}
      </GlassModal>
    </div>
  );
}
