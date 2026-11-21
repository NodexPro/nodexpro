import React, { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { ORGS } from '../api/endpoints';
import { PublicAuthShell } from '../components/auth/PublicAuthShell';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n/I18nProvider';
import { readStoredInviteReturnPath } from '../lib/invite-return-path.pure';
import { localizationValueAllowed } from '../lib/onboarding-form.pure';
import {
  destinationWhenOnboardingBlocked,
  isPrimaryOnboardingState,
} from '../lib/onboarding-session-route.pure';

export function CreateOrganization() {
  const auth = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const inviteReturn = readStoredInviteReturnPath(typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const localization = auth.status === 'authenticated' ? auth.me.localization : undefined;
  const countryOptions = localization?.country.options ?? [];
  const timezoneOptions = localization?.timezone.options ?? [];
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [timezone, setTimezone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const countryReady = countryOptions.length > 0;
  const timezoneReady = timezoneOptions.length > 0;

  const selectedCountry = useMemo(
    () => (localizationValueAllowed(countryCode, countryOptions) ? countryCode : ''),
    [countryCode, countryOptions],
  );
  const selectedTimezone = useMemo(
    () => (localizationValueAllowed(timezone, timezoneOptions) ? timezone : ''),
    [timezone, timezoneOptions],
  );

  if (auth.status !== 'authenticated') return null;
  if (inviteReturn) return <Navigate to={inviteReturn} replace />;
  if (!isPrimaryOnboardingState(auth.me.session_state)) {
    return (
      <Navigate
        to={destinationWhenOnboardingBlocked({
          sessionState: auth.me.session_state,
          redirectTo: auth.me.redirect_to,
        })}
        replace
      />
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('auth.organizationNameRequired'));
      return;
    }
    if (!selectedCountry) {
      setError(t('auth.countryRequired'));
      return;
    }
    if (!selectedTimezone) {
      setError(t('auth.timezoneRequired'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await apiJson<{ id: string; name: string; activeOrganizationId: string; membershipCreated: boolean }>(ORGS, {
        method: 'POST',
        body: JSON.stringify({ name: trimmedName, countryCode: selectedCountry, timezone: selectedTimezone }),
      });
      const me = await auth.refetchMe();
      if (!me) {
        setError(t('auth.organizationCreatedSessionFailed'));
        setLoading(false);
        return;
      }
      if (me.activeOrganizationId !== res.id) {
        setError(t('auth.organizationCreatedSessionFailed'));
        setLoading(false);
        return;
      }
      navigate(me.redirect_to || '/dashboard', { replace: true });
    } catch (err) {
      setError(userFacingApiMessage(err) || t('auth.createOrganizationFailed'));
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell title={t('auth.onboardingTitle')} testId="nx-onboarding">
      <form onSubmit={handleSubmit} aria-busy={loading} noValidate>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="organization-name">
            {t('auth.organizationName')}
          </label>
          <input
            id="organization-name"
            className="nx-glass-input"
            type="text"
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="organization-country">
            {t('auth.country')}
          </label>
          <select
            id="organization-country"
            className="nx-glass-input"
            value={selectedCountry}
            onChange={(e) => setCountryCode(e.target.value)}
            disabled={!countryReady || loading}
            required
          >
            <option value="">{t('auth.selectCountry')}</option>
            {countryOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="organization-timezone">
            {t('auth.timezone')}
          </label>
          <select
            id="organization-timezone"
            className="nx-glass-input"
            value={selectedTimezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!timezoneReady || loading}
            required
          >
            <option value="">{t('auth.selectTimezone')}</option>
            {timezoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="nx-glass-alert nx-glass-alert--error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="nx-glass-btn nx-glass-btn--purple" type="submit" disabled={loading || !countryReady || !timezoneReady}>
          {loading ? t('auth.creatingOrganization') : t('auth.createOrganization')}
        </button>
      </form>
    </PublicAuthShell>
  );
}
