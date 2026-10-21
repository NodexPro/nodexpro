import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { AUTH, orgSettings } from '../api/endpoints';
import { AccountRequiredMark } from '../components/glass/AccountRequiredMark';
import { useI18n } from '../i18n/I18nProvider';
import { supabase } from '../lib/supabase';
import '../styles/nx-glass-surface.css';
import '../styles/nx-settings-deep-ocean.css';

interface SettingsData {
  capabilities: {
    canEditSettings: boolean;
    showBankDetails: boolean;
    showOwnerIdentity: boolean;
  };
  legalEntityTypeToLabelKey: Record<string, string>;
  ownerIdentity?: {
    masked: string;
    isLocked: boolean;
    lockedAt: string | null;
    legalIdLabelKey: string;
    trialStatusCode: string;
    trialStatusLabelKey: string;
    trialStatusValue: string | null;
    trialEndsAt: string | null;
    daysRemaining: number | null;
  };
  profile?: {
    organizationName: string | null;
    legalEntityType: string | null;
    legalIdNumber: string | null;
    legalIdLabelKey: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postalCode: string | null;
    country: string | null;
    countryWarning?: string | null;
    phone: string | null;
    website: string | null;
    logoFileAssetId: string | null;
  };
  country_configuration?: {
    status: 'configured' | 'not_configured';
    active_pack: string | null;
    active_ruleset: string | null;
  };
  documentIdentity?: {
    displayNameOnDocuments: string | null;
    displayPhoneOnDocuments: boolean;
    displayWebsiteOnDocuments: boolean;
    displayAddressOnDocuments: boolean;
    documentFooterNote: string | null;
  };
  signature?: {
    signatureText: string | null;
    signatureImageFileAssetId: string | null;
  };
  bankDetails?: {
    bankAccountHolder: string | null;
    bankName: string | null;
    bankBranch: string | null;
    bankAccountNumber: string | null;
    iban: string | null;
    swift: string | null;
    displayBankDetailsOnDocuments: boolean;
  };
}

function formFromSettings(d: SettingsData): Record<string, unknown> {
  return {
    organizationName: d.profile?.organizationName ?? '',
    legalEntityType: d.profile?.legalEntityType ?? '',
    legalIdNumber: d.profile?.legalIdNumber ?? '',
    addressLine1: d.profile?.addressLine1 ?? '',
    addressLine2: d.profile?.addressLine2 ?? '',
    city: d.profile?.city ?? '',
    postalCode: d.profile?.postalCode ?? '',
    country: (d.profile?.country ?? '').toUpperCase(),
    phone: d.profile?.phone ?? '',
    website: d.profile?.website ?? '',
    displayNameOnDocuments: d.documentIdentity?.displayNameOnDocuments ?? '',
    displayPhoneOnDocuments: d.documentIdentity?.displayPhoneOnDocuments,
    displayWebsiteOnDocuments: d.documentIdentity?.displayWebsiteOnDocuments,
    displayAddressOnDocuments: d.documentIdentity?.displayAddressOnDocuments,
    documentFooterNote: d.documentIdentity?.documentFooterNote ?? '',
    signatureText: d.signature?.signatureText ?? '',
    bankAccountHolder: d.bankDetails?.bankAccountHolder ?? '',
    bankName: d.bankDetails?.bankName ?? '',
    bankBranch: d.bankDetails?.bankBranch ?? '',
    bankAccountNumber: d.bankDetails?.bankAccountNumber ?? '',
    iban: d.bankDetails?.iban ?? '',
    swift: d.bankDetails?.swift ?? '',
    displayBankDetailsOnDocuments: d.bankDetails?.displayBankDetailsOnDocuments,
  };
}

const FALLBACK_COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'IL', label: 'Israel' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
];

export function Settings() {
  const auth = useAuth();
  const { t, setLang } = useI18n();
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [additionalEmail, setAdditionalEmail] = useState('');
  const [securityBusy, setSecurityBusy] = useState(false);
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const [localizationBusy, setLocalizationBusy] = useState(false);
  const [locForm, setLocForm] = useState({
    language_code: 'en',
    timezone: 'Asia/Jerusalem',
    date_format: 'DD/MM/YYYY',
    display_currency_code: 'ILS',
  });

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError('');
    apiJson<SettingsData>(orgSettings(orgId), { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        setForm(formFromSettings(d));
      })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : t('settings.errors.loadFailed'));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t only used in error handler, no need to re-fetch when lang changes
  }, [orgId, reloadKey]);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.me.localization) return;
    setLocForm({
      language_code: auth.me.localization.language.current,
      timezone: auth.me.localization.timezone.current,
      date_format: auth.me.localization.date_format.current,
      display_currency_code: auth.me.localization.display_currency.current,
    });
  }, [auth]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !data?.capabilities.canEditSettings) return;
    setSaving(true);
    setError('');
    try {
      const selectedCountryCode = String(form.country ?? '').trim().toUpperCase();
      const countryOptions =
        auth.status === 'authenticated' && Array.isArray(auth.me.localization?.country.options) && auth.me.localization.country.options.length
          ? auth.me.localization.country.options
          : FALLBACK_COUNTRY_OPTIONS;
      const isKnownCountry = countryOptions.some((opt) => opt.code === selectedCountryCode);
      if (!isKnownCountry) {
        setError('Please select a valid country.');
        setSaving(false);
        return;
      }
      const payload = {
        organizationName: (form.organizationName as string) || null,
        legalEntityType: (form.legalEntityType as string) || null,
        legalIdNumber: (form.legalIdNumber as string) || null,
        addressLine1: (form.addressLine1 as string) || null,
        addressLine2: (form.addressLine2 as string) || null,
        city: (form.city as string) || null,
        postalCode: (form.postalCode as string) || null,
        country: selectedCountryCode,
        phone: (form.phone as string) || null,
        website: (form.website as string) || null,
        displayNameOnDocuments: (form.displayNameOnDocuments as string) || null,
        displayPhoneOnDocuments: !!form.displayPhoneOnDocuments,
        displayWebsiteOnDocuments: !!form.displayWebsiteOnDocuments,
        displayAddressOnDocuments: !!form.displayAddressOnDocuments,
        documentFooterNote: (form.documentFooterNote as string) || null,
        signatureText: (form.signatureText as string) || null,
        bankAccountHolder: (form.bankAccountHolder as string) || null,
        bankName: (form.bankName as string) || null,
        bankBranch: (form.bankBranch as string) || null,
        bankAccountNumber: (form.bankAccountNumber as string) || null,
        iban: (form.iban as string) || null,
        swift: (form.swift as string) || null,
        displayBankDetailsOnDocuments: !!form.displayBankDetailsOnDocuments,
      };
      const updated = await apiJson<SettingsData>(orgSettings(orgId), {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setData(updated);
      setForm(formFromSettings(updated));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-glass-page">{t('topBar.selectOrg')}</p>;

  const capabilities = data?.capabilities ?? {
    canEditSettings: false,
    showBankDetails: false,
    showOwnerIdentity: false,
  };
  const legalEntityTypes = Object.keys(data?.legalEntityTypeToLabelKey ?? {});

  const legalIdLabelKey =
    (form.legalEntityType as string) && data?.legalEntityTypeToLabelKey?.[form.legalEntityType as string]
      ? data.legalEntityTypeToLabelKey[form.legalEntityType as string]
      : 'settings.legalIdLabel.generic';

  const trialDisplayText = data?.ownerIdentity
    ? data.ownerIdentity.trialStatusValue
      ? t(data.ownerIdentity.trialStatusLabelKey).replace('{{date}}', data.ownerIdentity.trialStatusValue)
      : t(data.ownerIdentity.trialStatusLabelKey)
    : '';

  const isCountryConfigured = data?.country_configuration?.status === 'configured';
  const security = auth.status === 'authenticated' ? auth.me.account_security : undefined;
  const localization = auth.status === 'authenticated' ? auth.me.localization : undefined;
  const countryOptions =
    localization?.country.options?.length ? localization.country.options : FALLBACK_COUNTRY_OPTIONS;
  const securityActions = new Set(security?.allowed_actions ?? []);

  const runSecurityCommand = async (path: string, body: Record<string, unknown>) => {
    setSecurityBusy(true);
    setError('');
    try {
      const me = await apiJson(path, { method: 'POST', body: JSON.stringify(body) });
      await auth.refetchMe();
      return me;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.errors.saveFailed'));
    } finally {
      setSecurityBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    setSecurityBusy(true);
    setError('');
    setPasswordResetSent(false);
    try {
      const email = (security?.primary_login_email ?? auth.me.user.email ?? '').trim().toLowerCase();
      if (!email) {
        setError(t('settings.errors.saveFailed'));
        return;
      }
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetErr) throw new Error(resetErr.message);
      setPasswordResetSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.errors.saveFailed'));
    } finally {
      setSecurityBusy(false);
    }
  };

  const saveLocalization = async () => {
    setLocalizationBusy(true);
    setError('');
    try {
      await apiJson(AUTH.setLocalizationPreferences, {
        method: 'POST',
        body: JSON.stringify(locForm),
      });
      const refreshed = await auth.refetchMe();
      const nextLang = refreshed?.localization?.language.current;
      if (nextLang === 'en' || nextLang === 'he') setLang(nextLang);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.errors.saveFailed'));
    } finally {
      setLocalizationBusy(false);
    }
  };

  const localizationFields = (
    <div className="nx-settings-grid nx-settings-localization-fields">
      <label className="nx-glass-label">
        {t('settings.localization.language')}
        <select
          className="nx-glass-input"
          value={locForm.language_code}
          onChange={(e) => setLocForm((f) => ({ ...f, language_code: e.target.value }))}
        >
          {(localization?.language.options ?? [
            { locale: 'en', name: 'English' },
            { locale: 'he', name: 'עברית' },
          ]).map((opt) => (
            <option key={opt.locale} value={opt.locale}>
              {opt.name}
            </option>
          ))}
        </select>
      </label>
      <label className="nx-glass-label">
        {t('settings.localization.timezone')}
        <select
          className="nx-glass-input"
          value={locForm.timezone}
          onChange={(e) => setLocForm((f) => ({ ...f, timezone: e.target.value }))}
        >
          {(localization?.timezone.options ?? [{ value: 'Asia/Jerusalem', label: 'Asia/Jerusalem' }]).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <small className="nx-settings-muted">{t('settings.localization.timezoneNote')}</small>
      </label>
      <label className="nx-glass-label">
        {t('settings.localization.dateFormat')}
        <select
          className="nx-glass-input"
          value={locForm.date_format}
          onChange={(e) => setLocForm((f) => ({ ...f, date_format: e.target.value }))}
        >
          {(localization?.date_format.options ?? [
            { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
            { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
          ]).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <small className="nx-settings-muted">{t('settings.localization.dateFormatNote')}</small>
      </label>
      <label className="nx-glass-label">
        {t('settings.localization.currency')}
        <select
          className="nx-glass-input"
          value={locForm.display_currency_code}
          onChange={(e) => setLocForm((f) => ({ ...f, display_currency_code: e.target.value }))}
        >
          {(localization?.display_currency.options ?? [
            { code: 'ILS', label: 'ILS — ₪', symbol: '₪' },
            { code: 'USD', label: 'USD — $', symbol: '$' },
            { code: 'EUR', label: 'EUR — €', symbol: '€' },
          ]).map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label}
            </option>
          ))}
        </select>
        <small className="nx-settings-muted">{t('settings.localization.currencyNote')}</small>
      </label>
      <div className="nx-settings-localization-save">
        <button
          type="button"
          className="nx-glass-btn nx-glass-btn--purple"
          disabled={localizationBusy}
          onClick={() => void saveLocalization()}
        >
          {t('settings.localization.save')}
        </button>
      </div>
    </div>
  );

  const localizationSave = (
    <div className="nx-settings-localization-save">
      <button
        type="button"
        className="nx-glass-btn nx-glass-btn--purple"
        disabled={localizationBusy}
        title={t('settings.localization.currencyNote')}
        onClick={() => void saveLocalization()}
      >
        {t('settings.localization.save')}
      </button>
    </div>
  );

  const countryConfigBlock = (
    <div className="nx-settings-country-status">
      <h3>{t('settings.profile.countryStatus')}</h3>
      {loading && !data ? (
        <p className="nx-settings-placeholder" aria-busy="true">{t('common.loading')}</p>
      ) : (
        <p className={isCountryConfigured ? 'nx-settings-status-ok' : 'nx-settings-warning'}>
          {isCountryConfigured
            ? t('settings.profile.countryConfigured')
            : t('settings.profile.countryIncomplete')}
        </p>
      )}
    </div>
  );

  return (
    <div className="nx-glass-page nx-glass-page--wide nx-settings nx-settings-deep-ocean" data-testid="nx-settings">
      <h1 className="nx-glass-title">{t('settings.title')}</h1>
      <p className="nx-glass-subtitle">{t('settings.subtitle')}</p>

      {error && (
        <div className="nx-glass-alert nx-glass-alert--error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="nx-glass-btn nx-glass-btn--secondary"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {t('settings.errors.retry')}
          </button>
        </div>
      )}

      {data && !capabilities.canEditSettings && (
        <p className="nx-glass-alert nx-glass-alert--warn">
          {t('settings.readOnly')}
        </p>
      )}

      <section className="nx-glass-card nx-settings-pair-card">
        <div className="nx-settings-pair">
          <div className="nx-settings-pair__col">
            <h2>{t('settings.ownerIdentity.section')}</h2>
            <dl className="nx-settings-identity-table" data-testid="nx-settings-identity-table">
              <div className="nx-settings-identity-table__row">
                <dt>{t(data?.ownerIdentity?.legalIdLabelKey ?? 'settings.legalIdLabel.teudatZehut')}</dt>
                <dd className="nx-settings-readonly">
                  {loading && !data ? (
                    <span className="nx-settings-placeholder" aria-busy="true">{t('common.loading')}</span>
                  ) : (
                    data?.ownerIdentity?.masked ?? '—'
                  )}
                </dd>
              </div>
              <div className="nx-settings-identity-table__row">
                <dt>{t('settings.ownerIdentity.status')}</dt>
                <dd className="nx-settings-readonly">
                  {loading && !data ? (
                    <span className="nx-settings-placeholder" aria-busy="true">{t('common.loading')}</span>
                  ) : data?.ownerIdentity ? (
                    data.ownerIdentity.isLocked ? t('settings.ownerIdentity.locked') : t('settings.ownerIdentity.set')
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="nx-settings-identity-table__row">
                <dt>{t('settings.ownerIdentity.trialStatus')}</dt>
                <dd className="nx-settings-readonly">
                  {loading && !data ? (
                    <span className="nx-settings-placeholder" aria-busy="true">{t('common.loading')}</span>
                  ) : (
                    trialDisplayText || '—'
                  )}
                </dd>
              </div>
              <div className="nx-settings-identity-table__row">
                <dt>{t('settings.loginEmail')}</dt>
                <dd className="nx-settings-readonly">
                  <span>{security?.primary_login_email ?? auth.me.user.email}</span>
                  <span
                    className={
                      security?.primary_email_verified || auth.me.user.email_verified
                        ? 'nx-settings-verified'
                        : 'nx-settings-unverified'
                    }
                  >
                    {security?.primary_email_verified || auth.me.user.email_verified
                      ? t('settings.loginEmailVerified')
                      : t('settings.loginEmailUnverified')}
                  </span>
                </dd>
              </div>
              <div className="nx-settings-identity-table__row">
                <dt>{t('settings.passwordMasked')}</dt>
                <dd className="nx-settings-readonly">
                  <span aria-label={t('settings.passwordMasked')}>
                    {security?.password_indicator ?? '••••••••••••'}
                  </span>
                  <button
                    type="button"
                    className="nx-glass-link nx-settings-identity-action"
                    disabled={securityBusy}
                    onClick={() => void requestPasswordReset()}
                  >
                    {t('settings.changePasswordAction')}
                  </button>
                </dd>
              </div>
            </dl>
            {data?.ownerIdentity ? (
              <p className="nx-settings-muted nx-settings-identity-note">{t('settings.ownerIdentity.identityNote')}</p>
            ) : !loading ? (
              <p className="nx-settings-muted nx-settings-identity-note">{t('settings.noOwnerIdentity')}</p>
            ) : null}
          </div>

          <div className="nx-settings-pair__col" id="nx-account-security">
            <h2>{t('settings.accountSecurity.section')}</h2>
            <dl className="nx-settings-identity-table" data-testid="nx-settings-security-table">
              <div className="nx-settings-identity-table__row">
                <dt>
                  {t('settings.accountSecurity.additionalEmail')}
                  {(securityActions.has('request_additional_login_email') ||
                    securityActions.has('replace_additional_login_email')) && <AccountRequiredMark />}
                </dt>
                <dd>
                  {security?.additional_login_email ? (
                    <span>
                      {security.additional_login_email}
                      <span className="nx-settings-verified"> {t('settings.accountSecurity.verified')}</span>
                    </span>
                  ) : null}
                  {security?.additional_pending_email ? (
                    <span className="nx-settings-verified" title={t('settings.accountSecurity.additionalEmailHint')}>
                      {t('settings.accountSecurity.pending')}: {security.additional_pending_email}
                    </span>
                  ) : null}
                  {(securityActions.has('request_additional_login_email') ||
                    securityActions.has('replace_additional_login_email')) && (
                    <form
                      className="nx-settings-security-inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void runSecurityCommand(
                          securityActions.has('replace_additional_login_email')
                            ? AUTH.replaceAdditionalLoginEmail
                            : AUTH.requestAdditionalLoginEmail,
                          { email: additionalEmail },
                        );
                      }}
                    >
                      <input
                        className="nx-glass-input"
                        type="email"
                        value={additionalEmail}
                        placeholder="name@example.com"
                        aria-label={t('settings.accountSecurity.additionalEmail')}
                        title={t('settings.accountSecurity.additionalEmailHint')}
                        onChange={(e) => setAdditionalEmail(e.target.value)}
                        required
                      />
                      <button type="submit" className="nx-glass-btn nx-glass-btn--purple" disabled={securityBusy}>
                        {securityActions.has('replace_additional_login_email')
                          ? t('settings.accountSecurity.replaceEmail')
                          : t('settings.accountSecurity.addEmail')}
                      </button>
                    </form>
                  )}
                  {securityActions.has('resend_additional_login_email') ? (
                    <button
                      type="button"
                      className="nx-glass-btn nx-glass-btn--secondary"
                      disabled={securityBusy}
                      onClick={() => void runSecurityCommand(AUTH.resendAdditionalLoginEmail, {})}
                    >
                      {t('settings.accountSecurity.resend')}
                    </button>
                  ) : null}
                  {securityActions.has('remove_additional_login_email') ? (
                    <button
                      type="button"
                      className="nx-glass-btn nx-glass-btn--secondary"
                      disabled={securityBusy}
                      onClick={() => void runSecurityCommand(AUTH.removeAdditionalLoginEmail, {})}
                    >
                      {t('settings.accountSecurity.removeEmail')}
                    </button>
                  ) : null}
                </dd>
              </div>
              <div className="nx-settings-identity-table__row">
                <dt>{t('settings.changePasswordAction')}</dt>
                <dd>
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--purple"
                    disabled={securityBusy}
                    title={t('settings.accountSecurity.resetHint')}
                    onClick={() => void requestPasswordReset()}
                  >
                    {t('settings.accountSecurity.sendResetLink')}
                  </button>
                  {passwordResetSent ? (
                    <span className="nx-settings-verified" role="status">
                      {t('settings.accountSecurity.resetSent')}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {data && capabilities.canEditSettings && (
        <form onSubmit={save}>
          <section className="nx-glass-card">
            <h2>{t('settings.profile.section')}</h2>
            <div className="nx-settings-grid nx-settings-profile-grid">
              <label className="nx-glass-label">
                {t('settings.profile.organizationName')}
                <input
                  type="text"
                  value={(form.organizationName as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, organizationName: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.legalEntityType')}
                <select
                  value={(form.legalEntityType as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, legalEntityType: e.target.value }))}
                  className="nx-glass-input"
                  disabled={!capabilities.canEditSettings}
                >
                  <option value="">—</option>
                  {legalEntityTypes.map((code) => (
                    <option key={code} value={code}>
                      {t(`settings.legalEntityType.${code}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nx-glass-label">
                {t(legalIdLabelKey)}
                <input
                  type="text"
                  value={(form.legalIdNumber as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, legalIdNumber: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.country')}
                <select
                  value={(form.country as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  className="nx-glass-input"
                  disabled={!capabilities.canEditSettings}
                >
                  <option value="">Select country</option>
                  {countryOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {data?.profile?.countryWarning ? (
                  <span className="nx-settings-warning">{data.profile.countryWarning}</span>
                ) : null}
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.addressLine1')}
                <input
                  type="text"
                  value={(form.addressLine1 as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.city')}
                <input
                  type="text"
                  value={(form.city as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.addressLine2')}
                <input
                  type="text"
                  value={(form.addressLine2 as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.postalCode')}
                <input
                  type="text"
                  value={(form.postalCode as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.phone')}
                <input
                  type="tel"
                  value={(form.phone as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="nx-glass-input"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.profile.website')}
                <input
                  type="url"
                  value={(form.website as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="nx-glass-input"
                  placeholder="https://"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label className="nx-glass-label">
                {t('settings.localization.language')}
                <select
                  className="nx-glass-input"
                  value={locForm.language_code}
                  onChange={(e) => setLocForm((f) => ({ ...f, language_code: e.target.value }))}
                >
                  {(localization?.language.options ?? [
                    { locale: 'en', name: 'English' },
                    { locale: 'he', name: 'עברית' },
                  ]).map((opt) => (
                    <option key={opt.locale} value={opt.locale}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nx-glass-label">
                {t('settings.localization.timezone')}
                <select
                  className="nx-glass-input"
                  value={locForm.timezone}
                  title={t('settings.localization.timezoneNote')}
                  onChange={(e) => setLocForm((f) => ({ ...f, timezone: e.target.value }))}
                >
                  {(localization?.timezone.options ?? [{ value: 'Asia/Jerusalem', label: 'Asia/Jerusalem' }]).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nx-glass-label">
                {t('settings.localization.dateFormat')}
                <select
                  className="nx-glass-input"
                  value={locForm.date_format}
                  title={t('settings.localization.dateFormatNote')}
                  onChange={(e) => setLocForm((f) => ({ ...f, date_format: e.target.value }))}
                >
                  {(localization?.date_format.options ?? [
                    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                  ]).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nx-glass-label">
                {t('settings.localization.currency')}
                <select
                  className="nx-glass-input"
                  value={locForm.display_currency_code}
                  title={t('settings.localization.currencyNote')}
                  onChange={(e) => setLocForm((f) => ({ ...f, display_currency_code: e.target.value }))}
                >
                  {(localization?.display_currency.options ?? [
                    { code: 'ILS', label: 'ILS — ₪', symbol: '₪' },
                    { code: 'USD', label: 'USD — $', symbol: '$' },
                    { code: 'EUR', label: 'EUR — €', symbol: '€' },
                  ]).map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {localizationSave}
            {countryConfigBlock}
          </section>

          <section className="nx-glass-card nx-settings-pair-card">
            <div className="nx-settings-pair">
              <div className="nx-settings-pair__col">
                <h2>{t('settings.documentIdentity.section')}</h2>
                <div className="nx-settings-fields">
                  <label className="nx-glass-label">
                    {t('settings.documentIdentity.displayNameOnDocuments')}
                    <input
                      type="text"
                      value={(form.displayNameOnDocuments as string) ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, displayNameOnDocuments: e.target.value }))}
                      className="nx-glass-input"
                      readOnly={!capabilities.canEditSettings}
                    />
                  </label>
                  <label className="nx-settings-check">
                    <input
                      type="checkbox"
                      checked={!!form.displayPhoneOnDocuments}
                      onChange={(e) => setForm((f) => ({ ...f, displayPhoneOnDocuments: e.target.checked }))}
                      disabled={!capabilities.canEditSettings}
                    />
                    {t('settings.documentIdentity.displayPhoneOnDocuments')}
                  </label>
                  <label className="nx-settings-check">
                    <input
                      type="checkbox"
                      checked={!!form.displayWebsiteOnDocuments}
                      onChange={(e) => setForm((f) => ({ ...f, displayWebsiteOnDocuments: e.target.checked }))}
                      disabled={!capabilities.canEditSettings}
                    />
                    {t('settings.documentIdentity.displayWebsiteOnDocuments')}
                  </label>
                  <label className="nx-settings-check">
                    <input
                      type="checkbox"
                      checked={!!form.displayAddressOnDocuments}
                      onChange={(e) => setForm((f) => ({ ...f, displayAddressOnDocuments: e.target.checked }))}
                      disabled={!capabilities.canEditSettings}
                    />
                    {t('settings.documentIdentity.displayAddressOnDocuments')}
                  </label>
                  <label className="nx-glass-label">
                    {t('settings.documentIdentity.documentFooterNote')}
                    <input
                      type="text"
                      value={(form.documentFooterNote as string) ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, documentFooterNote: e.target.value }))}
                      className="nx-glass-input"
                      placeholder={t('settings.documentIdentity.footerNotePlaceholder')}
                      readOnly={!capabilities.canEditSettings}
                    />
                  </label>
                </div>
              </div>

              {capabilities.showBankDetails && data?.bankDetails !== undefined && (
                <div className="nx-settings-pair__col">
                  <h2>{t('settings.bankDetails.section')}</h2>
                  <div className="nx-settings-fields">
                    <label className="nx-glass-label">
                      {t('settings.bankDetails.bankAccountHolder')}
                      <input
                        type="text"
                        value={(form.bankAccountHolder as string) ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, bankAccountHolder: e.target.value }))}
                        className="nx-glass-input"
                        readOnly={!capabilities.canEditSettings}
                      />
                    </label>
                    <label className="nx-glass-label">
                      {t('settings.bankDetails.bankName')}
                      <input
                        type="text"
                        value={(form.bankName as string) ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                        className="nx-glass-input"
                        readOnly={!capabilities.canEditSettings}
                      />
                    </label>
                    <label className="nx-glass-label">
                      {t('settings.bankDetails.bankBranch')}
                      <input
                        type="text"
                        value={(form.bankBranch as string) ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, bankBranch: e.target.value }))}
                        className="nx-glass-input"
                        readOnly={!capabilities.canEditSettings}
                      />
                    </label>
                    <label className="nx-glass-label">
                      {t('settings.bankDetails.bankAccountNumber')}
                      <input
                        type="text"
                        value={(form.bankAccountNumber as string) ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                        className="nx-glass-input"
                        readOnly={!capabilities.canEditSettings}
                      />
                    </label>
                    <label className="nx-glass-label">
                      {t('settings.bankDetails.iban')}
                      <input
                        type="text"
                        value={(form.iban as string) ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))}
                        className="nx-glass-input"
                        readOnly={!capabilities.canEditSettings}
                      />
                    </label>
                    <label className="nx-glass-label">
                      {t('settings.bankDetails.swift')}
                      <input
                        type="text"
                        value={(form.swift as string) ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, swift: e.target.value }))}
                        className="nx-glass-input"
                        readOnly={!capabilities.canEditSettings}
                      />
                    </label>
                    <label className="nx-settings-check">
                      <input
                        type="checkbox"
                        checked={!!form.displayBankDetailsOnDocuments}
                        onChange={(e) => setForm((f) => ({ ...f, displayBankDetailsOnDocuments: e.target.checked }))}
                        disabled={!capabilities.canEditSettings}
                      />
                      {t('settings.bankDetails.displayBankDetailsOnDocuments')}
                    </label>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="nx-glass-card">
            <h2>{t('settings.signature.section')}</h2>
            <label className="nx-glass-label">
              {t('settings.signature.signatureText')}
              <input
                type="text"
                value={(form.signatureText as string) ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, signatureText: e.target.value }))}
                className="nx-glass-input"
                placeholder={t('settings.signature.signatureTextPlaceholder')}
                readOnly={!capabilities.canEditSettings}
              />
            </label>
          </section>

          <div className="nx-settings-actions nx-settings-actions--footer">
            <button type="submit" disabled={saving} className="nx-glass-btn nx-glass-btn--purple">
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="nx-glass-btn nx-glass-btn--secondary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {loading && !data && (
        <section className="nx-glass-card" aria-busy="true">
          <h2>{t('settings.profile.section')}</h2>
          <p className="nx-settings-placeholder">{t('common.loading')}</p>
        </section>
      )}

      {data && !capabilities.canEditSettings && (
        <section className="nx-glass-card">
          <h2>{t('settings.profile.section')}</h2>
          <dl className="nx-settings-readonly-list">
            <dt>{t('settings.profile.organizationName')}</dt>
            <dd>{data.profile?.organizationName ?? '—'}</dd>
            <dt>{t('settings.profile.legalEntityType')}</dt>
            <dd>{data.profile?.legalEntityType ? t(`settings.legalEntityType.${data.profile.legalEntityType}`) : '—'}</dd>
            <dt>{t(data.profile?.legalIdLabelKey ?? 'settings.legalIdLabel.generic')}</dt>
            <dd>{data.profile?.legalIdNumber ?? '—'}</dd>
            <dt>{t('settings.profile.country')}</dt>
            <dd>{data.profile?.country ?? '—'}</dd>
            <dt>{t('settings.profile.addressLine1')}</dt>
            <dd>{data.profile?.addressLine1 ?? '—'}</dd>
            <dt>{t('settings.profile.city')}</dt>
            <dd>{data.profile?.city ?? '—'}</dd>
            <dt>{t('settings.profile.addressLine2')}</dt>
            <dd>{data.profile?.addressLine2 ?? '—'}</dd>
            <dt>{t('settings.profile.postalCode')}</dt>
            <dd>{data.profile?.postalCode ?? '—'}</dd>
            <dt>{t('settings.profile.phone')}</dt>
            <dd>{data.profile?.phone ?? '—'}</dd>
            <dt>{t('settings.profile.website')}</dt>
            <dd>{data.profile?.website ?? '—'}</dd>
          </dl>
          {localizationFields}
          {countryConfigBlock}
        </section>
      )}
    </div>
  );
}
