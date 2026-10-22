import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgModulesState } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import {
  matchingPlan,
  subscribedCommercialModules,
  type OfficeModuleStateItem,
  type OfficeModulesState,
} from '../modules/office-modules-state';
import '../styles/nx-glass-surface.css';
import '../styles/nx-office-deep-ocean.css';

function formatBackendDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB');
}

function billingPeriodLabel(period: string | null | undefined, t: (key: string) => string): string {
  if (period === 'year') return t('modules.periodYear');
  if (period === 'month') return t('modules.periodMonth');
  return t('common.unavailable');
}

export function Billing() {
  const auth = useAuth();
  const { t, lang } = useI18n();
  const [modules, setModules] = useState<OfficeModuleStateItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError('');
    apiJson<OfficeModulesState>(orgModulesState(orgId), { signal: ac.signal })
      .then((res) => {
        if (!ac.signal.aborted) setModules(res.modules);
      })
      .catch((e) => {
        if (!ac.signal.aborted && (e as Error)?.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [orgId]);

  const withSubscription = subscribedCommercialModules(modules);

  if (auth.status !== 'authenticated') return null;

  return (
    <div className="nx-glass-page nx-glass-page--wide nx-office-ocean" data-testid="nx-billing">
      <h1 className="nx-glass-title">{t('billing.title')}</h1>
      <p className="nx-glass-subtitle">{t('billing.subtitle')}</p>
      {error && (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          {error}
        </div>
      )}

      <section className="nx-glass-card">
        <h2>{t('billing.summary')}</h2>
        <dl className="nx-glass-dl">
          <dt>{t('billing.activeModules')}</dt>
          <dd>
            {withSubscription.length === 0
              ? t('billing.empty')
              : withSubscription.map((module) => module.name).join(', ')}
          </dd>
          <dt>{t('billing.tax')}</dt>
          <dd>{t('billing.taxUnavailable')}</dd>
          <dt>{t('billing.totalPayable')}</dt>
          <dd>{t('billing.totalUnavailable')}</dd>
          <dt>{t('billing.nextBilling')}</dt>
          <dd>{t('billing.nextBillingUnavailable')}</dd>
          <dt>{t('billing.paymentStatus')}</dt>
          <dd>{t('billing.paymentStatusUnavailable')}</dd>
        </dl>
        <p className="nx-glass-muted" style={{ marginTop: 16 }}>
          <Link className="nx-glass-link" to="/modules">
            {t('billing.manageModules')}
          </Link>{' '}
          {t('billing.manageModulesHint')}
        </p>
      </section>

      <section className="nx-glass-card">
        <h2>{t('billing.subscriptions')}</h2>
        {loading ? (
          <p className="nx-glass-muted">{t('common.loading')}</p>
        ) : withSubscription.length === 0 ? (
          <p className="nx-glass-muted">{t('billing.empty')}</p>
        ) : (
          <div className="nx-glass-table-wrap">
            <table className="nx-glass-table">
              <thead>
                <tr>
                  <th>{t('billing.module')}</th>
                  <th>{t('billing.activationStatus')}</th>
                  <th>{t('billing.interval')}</th>
                  <th>{t('billing.price')}</th>
                  <th>{t('billing.startedAt')}</th>
                  <th>{t('billing.endsAt')}</th>
                  <th>{t('billing.action')}</th>
                </tr>
              </thead>
              <tbody>
                {withSubscription.map((module) => {
                  const subscription = module.currentSubscription!;
                  const plan = matchingPlan(module);
                  return (
                    <tr key={module.moduleId}>
                      <td>{module.name}</td>
                      <td>
                        {t(`modules.activationStatus.${module.activationStatus}`) ===
                        `modules.activationStatus.${module.activationStatus}`
                          ? module.activationStatus
                          : t(`modules.activationStatus.${module.activationStatus}`)}
                      </td>
                      <td>{billingPeriodLabel(plan?.billingPeriod, t)}</td>
                      <td>
                        {subscription.currency} {subscription.priceAmount}
                      </td>
                      <td>{formatBackendDate(subscription.startedAt, lang) ?? t('common.unavailable')}</td>
                      <td>{formatBackendDate(subscription.endsAt, lang) ?? t('common.unavailable')}</td>
                      <td>
                        <Link className="nx-glass-link" to="/modules">
                          {t('billing.manageModules')}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="nx-glass-card" data-testid="nx-billing-payer">
        <h2>{t('billing.payer.title')}</h2>
        <p className="nx-glass-muted">{t('billing.payer.unavailable')}</p>
        <dl className="nx-glass-dl">
          <dt>{t('billing.payer.legalName')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.payer.taxId')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.payer.address')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.payer.email')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.payer.country')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.payer.invoiceRecipient')}</dt>
          <dd>{t('common.unavailable')}</dd>
        </dl>
      </section>

      <section className="nx-glass-card" data-testid="nx-billing-payment-method">
        <h2>{t('billing.paymentMethod.title')}</h2>
        <p className="nx-glass-muted">{t('billing.paymentMethod.unavailable')}</p>
        <dl className="nx-glass-dl">
          <dt>{t('billing.paymentMethod.provider')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.paymentMethod.brand')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.paymentMethod.last4')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.paymentMethod.expiration')}</dt>
          <dd>{t('common.unavailable')}</dd>
          <dt>{t('billing.paymentMethod.status')}</dt>
          <dd>{t('common.unavailable')}</dd>
        </dl>
        <button type="button" className="nx-glass-btn nx-glass-btn--secondary" disabled>
          {t('billing.paymentMethod.changeUnavailable')}
        </button>
      </section>

      <section className="nx-glass-card" data-testid="nx-billing-history">
        <h2>{t('billing.history.title')}</h2>
        <p className="nx-glass-muted">{t('billing.history.unavailable')}</p>
      </section>
    </div>
  );
}
