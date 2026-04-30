import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgCountrySettings, orgSettings } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';

const sectionStyle: React.CSSProperties = {
  marginBottom: 32,
  padding: 24,
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
};

const sectionTitle: React.CSSProperties = { fontSize: '1rem', fontWeight: 600, marginBottom: 16 };

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

interface CountrySettingsData {
  aggregate_key: 'organization_country_settings_aggregate';
  mode: 'read_only';
  managed_by: 'platform_owner';
  organization: {
    id: string;
    country_code: string | null;
    name: string | null;
  } | null;
  settings_status: string;
  eligible_packs: Array<{
    id: string;
    pack_code: string;
    name: string;
    status: string;
    code_version: string;
    status_badge?: { label?: string };
  }>;
  active_pack: {
    id?: string;
    pack_code?: string;
    name?: string;
    status?: string;
  } | null;
  active_ruleset: {
    id?: string;
    ruleset_code?: string;
    ruleset_version?: string;
    effective_from?: string;
    effective_to?: string | null;
    status?: string;
  } | null;
  diagnostics: string[];
  warnings?: string[];
  note: string;
}

const COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'IL', label: 'Israel' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
];

export function Settings() {
  const auth = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [countryConfig, setCountryConfig] = useState<CountrySettingsData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([
      apiJson<SettingsData>(orgSettings(orgId), { signal: ac.signal }),
      apiJson<CountrySettingsData>(orgCountrySettings(orgId), { signal: ac.signal }),
    ])
      .then(([d, countryCfg]) => {
        if (ac.signal.aborted) return;
        setData(d);
        setCountryConfig(countryCfg);
        setForm({
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
        });
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !data?.capabilities.canEditSettings) return;
    setSaving(true);
    setError('');
    try {
      const selectedCountryCode = String(form.country ?? '').trim().toUpperCase();
      const isKnownCountry = COUNTRY_OPTIONS.some((opt) => opt.code === selectedCountryCode);
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
      const countryCfg = await apiJson<CountrySettingsData>(orgCountrySettings(orgId));
      setCountryConfig(countryCfg);
      setForm({
        organizationName: updated.profile?.organizationName ?? '',
        legalEntityType: updated.profile?.legalEntityType ?? '',
        legalIdNumber: updated.profile?.legalIdNumber ?? '',
        addressLine1: updated.profile?.addressLine1 ?? '',
        addressLine2: updated.profile?.addressLine2 ?? '',
        city: updated.profile?.city ?? '',
        postalCode: updated.profile?.postalCode ?? '',
        country: (updated.profile?.country ?? '').toUpperCase(),
        phone: updated.profile?.phone ?? '',
        website: updated.profile?.website ?? '',
        displayNameOnDocuments: updated.documentIdentity?.displayNameOnDocuments ?? '',
        displayPhoneOnDocuments: updated.documentIdentity?.displayPhoneOnDocuments,
        displayWebsiteOnDocuments: updated.documentIdentity?.displayWebsiteOnDocuments,
        displayAddressOnDocuments: updated.documentIdentity?.displayAddressOnDocuments,
        documentFooterNote: updated.documentIdentity?.documentFooterNote ?? '',
        signatureText: updated.signature?.signatureText ?? '',
        bankAccountHolder: updated.bankDetails?.bankAccountHolder ?? '',
        bankName: updated.bankDetails?.bankName ?? '',
        bankBranch: updated.bankDetails?.bankBranch ?? '',
        bankAccountNumber: updated.bankDetails?.bankAccountNumber ?? '',
        iban: updated.bankDetails?.iban ?? '',
        swift: updated.bankDetails?.swift ?? '',
        displayBankDetailsOnDocuments: updated.bankDetails?.displayBankDetailsOnDocuments,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    display: 'block',
    marginTop: 4,
    padding: '8px 12px',
    width: '100%',
    maxWidth: 400,
    borderRadius: 8,
    border: '1px solid #d1d5db',
  };

  const profileInputStyle: React.CSSProperties = {
    ...inputStyle,
    marginTop: 0,
    height: 32,
    padding: '0 10px',
    borderRadius: 6,
    fontSize: 14,
    lineHeight: 'normal',
    maxWidth: '100%',
    boxSizing: 'border-box',
  };

  const profileLabelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 14,
    fontWeight: 500,
    color: '#6b7280',
    margin: 0,
    lineHeight: 1.2,
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p style={{ padding: 24 }}>{t('topBar.selectOrg')}</p>;

  if (loading) return <p style={{ padding: 24 }}>{t('common.loading')}</p>;
  if (!data) return null;

  const { capabilities } = data;
  const legalEntityTypes = Object.keys(data.legalEntityTypeToLabelKey ?? {});

  const legalIdLabelKey =
    (form.legalEntityType as string) && data.legalEntityTypeToLabelKey?.[form.legalEntityType as string]
      ? data.legalEntityTypeToLabelKey[form.legalEntityType as string]
      : 'settings.legalIdLabel.generic';

  const trialDisplayText = data.ownerIdentity
    ? data.ownerIdentity.trialStatusValue
      ? t(data.ownerIdentity.trialStatusLabelKey).replace('{{date}}', data.ownerIdentity.trialStatusValue)
      : t(data.ownerIdentity.trialStatusLabelKey)
    : '';

  const isCountryConfigured = countryConfig?.settings_status === 'configured';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>{t('settings.title')}</h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>{t('settings.subtitle')}</p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!capabilities.canEditSettings && (
        <p style={{ padding: 12, background: '#fef3c7', color: '#92400e', borderRadius: 8, marginBottom: 24 }}>
          {t('settings.readOnly')}
        </p>
      )}

      {capabilities.showOwnerIdentity && data.ownerIdentity && (
        <section style={sectionStyle}>
          <h2 style={sectionTitle}>{t('settings.ownerIdentity.section')}</h2>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: 16, rowGap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <dt
                style={{
                  display: 'block',
                  fontSize: 14,
                  color: '#6b7280',
                  marginBottom: 4,
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {t(data.ownerIdentity.legalIdLabelKey)}
              </dt>
              <dd
                style={{
                  display: 'block',
                  margin: 0,
                  fontFamily: 'monospace',
                  fontWeight: 500,
                  fontSize: 14,
                  color: '#111827',
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {data.ownerIdentity.masked ?? '***'}
              </dd>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <dt
                style={{
                  display: 'block',
                  fontSize: 14,
                  color: '#6b7280',
                  marginBottom: 4,
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {t('settings.ownerIdentity.status')}
              </dt>
              <dd
                style={{
                  display: 'block',
                  margin: 0,
                  fontWeight: 500,
                  fontSize: 14,
                  color: '#111827',
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {data.ownerIdentity.isLocked ? t('settings.ownerIdentity.locked') : t('settings.ownerIdentity.set')}
              </dd>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <dt
                style={{
                  display: 'block',
                  fontSize: 14,
                  color: '#6b7280',
                  marginBottom: 4,
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {t('settings.ownerIdentity.trialStatus')}
              </dt>
              <dd
                style={{
                  display: 'block',
                  margin: 0,
                  fontWeight: 500,
                  fontSize: 14,
                  color: '#111827',
                  lineHeight: 1.4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {trialDisplayText}
              </dd>
            </div>
          </dl>
          <p style={{ marginTop: 16, marginBottom: 0, fontSize: 13, color: '#6b7280' }}>{t('settings.ownerIdentity.identityNote')}</p>
        </section>
      )}

      {!capabilities.showOwnerIdentity && (
        <section style={sectionStyle}>
          <p style={{ color: '#6b7280', margin: 0 }}>{t('settings.noOwnerIdentity')}</p>
        </section>
      )}

      {capabilities.canEditSettings && (
        <form onSubmit={save}>
          <section style={sectionStyle}>
            <h2 style={sectionTitle}>{t('settings.profile.section')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'start', fontSize: 14 }}>
              <label style={profileLabelStyle}>
                {t('settings.profile.organizationName')}
                <input
                  type="text"
                  value={(form.organizationName as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, organizationName: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.legalEntityType')}
                <select
                  value={(form.legalEntityType as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, legalEntityType: e.target.value }))}
                  style={profileInputStyle}
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
              <label style={profileLabelStyle}>
                {t(legalIdLabelKey)}
                <input
                  type="text"
                  value={(form.legalIdNumber as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, legalIdNumber: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.addressLine1')}
                <input
                  type="text"
                  value={(form.addressLine1 as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.addressLine2')}
                <input
                  type="text"
                  value={(form.addressLine2 as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.city')}
                <input
                  type="text"
                  value={(form.city as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.postalCode')}
                <input
                  type="text"
                  value={(form.postalCode as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.country')}
                <select
                  value={(form.country as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  style={profileInputStyle}
                  disabled={!capabilities.canEditSettings}
                >
                  <option value="">Select country</option>
                  {COUNTRY_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {data.profile?.countryWarning ? (
                  <span style={{ fontSize: 12, color: '#b45309', fontWeight: 400 }}>{data.profile.countryWarning}</span>
                ) : null}
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.phone')}
                <input
                  type="tel"
                  value={(form.phone as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  style={profileInputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={profileLabelStyle}>
                {t('settings.profile.website')}
                <input
                  type="url"
                  value={(form.website as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  style={profileInputStyle}
                  placeholder="https://"
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
            </div>
            <div style={{ marginTop: 16, border: '1px solid #d1d5db', borderRadius: 8, padding: 12, background: '#f9fafb' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: 15 }}>Country Configuration</h3>
              <p style={{ margin: 0, color: isCountryConfigured ? '#065f46' : '#92400e', fontSize: 14, fontWeight: 500 }}>
                {isCountryConfigured
                  ? '✔ Country is configured and ready'
                  : '⚠ Country configuration incomplete. Contact support.'}
              </p>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitle}>{t('settings.documentIdentity.section')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={profileLabelStyle}>
                {t('settings.documentIdentity.displayNameOnDocuments')}
                <input
                  type="text"
                  value={(form.displayNameOnDocuments as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, displayNameOnDocuments: e.target.value }))}
                  style={inputStyle}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: '#6b7280' }}>
                <input
                  type="checkbox"
                  checked={!!form.displayPhoneOnDocuments}
                  onChange={(e) => setForm((f) => ({ ...f, displayPhoneOnDocuments: e.target.checked }))}
                  disabled={!capabilities.canEditSettings}
                />
                {t('settings.documentIdentity.displayPhoneOnDocuments')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: '#6b7280' }}>
                <input
                  type="checkbox"
                  checked={!!form.displayWebsiteOnDocuments}
                  onChange={(e) => setForm((f) => ({ ...f, displayWebsiteOnDocuments: e.target.checked }))}
                  disabled={!capabilities.canEditSettings}
                />
                {t('settings.documentIdentity.displayWebsiteOnDocuments')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: '#6b7280' }}>
                <input
                  type="checkbox"
                  checked={!!form.displayAddressOnDocuments}
                  onChange={(e) => setForm((f) => ({ ...f, displayAddressOnDocuments: e.target.checked }))}
                  disabled={!capabilities.canEditSettings}
                />
                {t('settings.documentIdentity.displayAddressOnDocuments')}
              </label>
              <label style={profileLabelStyle}>
                {t('settings.documentIdentity.documentFooterNote')}
                <input
                  type="text"
                  value={(form.documentFooterNote as string) ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, documentFooterNote: e.target.value }))}
                  style={inputStyle}
                  placeholder={t('settings.documentIdentity.footerNotePlaceholder')}
                  readOnly={!capabilities.canEditSettings}
                />
              </label>
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 style={sectionTitle}>{t('settings.signature.section')}</h2>
            <label style={profileLabelStyle}>
              {t('settings.signature.signatureText')}
              <input
                type="text"
                value={(form.signatureText as string) ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, signatureText: e.target.value }))}
                style={inputStyle}
                placeholder={t('settings.signature.signatureTextPlaceholder')}
                readOnly={!capabilities.canEditSettings}
              />
            </label>
          </section>

          {capabilities.showBankDetails && data.bankDetails !== undefined && (
            <section style={sectionStyle}>
              <h2 style={sectionTitle}>{t('settings.bankDetails.section')}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
                <label style={profileLabelStyle}>
                  {t('settings.bankDetails.bankAccountHolder')}
                  <input
                    type="text"
                    value={(form.bankAccountHolder as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, bankAccountHolder: e.target.value }))}
                    style={profileInputStyle}
                    readOnly={!capabilities.canEditSettings}
                  />
                </label>
                <label style={profileLabelStyle}>
                  {t('settings.bankDetails.bankName')}
                  <input
                    type="text"
                    value={(form.bankName as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                    style={profileInputStyle}
                    readOnly={!capabilities.canEditSettings}
                  />
                </label>
                <label style={profileLabelStyle}>
                  {t('settings.bankDetails.bankBranch')}
                  <input
                    type="text"
                    value={(form.bankBranch as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, bankBranch: e.target.value }))}
                    style={profileInputStyle}
                    readOnly={!capabilities.canEditSettings}
                  />
                </label>
                <label style={profileLabelStyle}>
                  {t('settings.bankDetails.bankAccountNumber')}
                  <input
                    type="text"
                    value={(form.bankAccountNumber as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                    style={profileInputStyle}
                    readOnly={!capabilities.canEditSettings}
                  />
                </label>
                <label style={profileLabelStyle}>
                  {t('settings.bankDetails.iban')}
                  <input
                    type="text"
                    value={(form.iban as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))}
                    style={profileInputStyle}
                    readOnly={!capabilities.canEditSettings}
                  />
                </label>
                <label style={profileLabelStyle}>
                  {t('settings.bankDetails.swift')}
                  <input
                    type="text"
                    value={(form.swift as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, swift: e.target.value }))}
                    style={profileInputStyle}
                    readOnly={!capabilities.canEditSettings}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: '#6b7280', gridColumn: '1 / -1' }}>
                  <input
                    type="checkbox"
                    checked={!!form.displayBankDetailsOnDocuments}
                    onChange={(e) => setForm((f) => ({ ...f, displayBankDetailsOnDocuments: e.target.checked }))}
                    disabled={!capabilities.canEditSettings}
                  />
                  {t('settings.bankDetails.displayBankDetailsOnDocuments')}
                </label>
              </div>
            </section>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button type="submit" disabled={saving} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {!capabilities.canEditSettings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section style={sectionStyle}>
            <h2 style={sectionTitle}>{t('settings.profile.section')}</h2>
            <dl style={{ margin: 0, display: 'grid', gap: '8px 24px', gridTemplateColumns: 'auto 1fr' }}>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t('settings.profile.organizationName')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.organizationName ?? '—'}</dd>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t('settings.profile.legalEntityType')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.legalEntityType ? t(`settings.legalEntityType.${data.profile.legalEntityType}`) : '—'}</dd>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t(data.profile?.legalIdLabelKey ?? 'settings.legalIdLabel.generic')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.legalIdNumber ?? '—'}</dd>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t('settings.profile.addressLine1')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.addressLine1 ?? '—'}</dd>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t('settings.profile.city')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.city ?? '—'}</dd>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t('settings.profile.phone')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.phone ?? '—'}</dd>
              <dt style={{ color: '#6b7280', fontSize: 14 }}>{t('settings.profile.website')}</dt>
              <dd style={{ margin: 0 }}>{data.profile?.website ?? '—'}</dd>
            </dl>
            <div style={{ marginTop: 16, border: '1px solid #d1d5db', borderRadius: 8, padding: 12, background: '#f9fafb' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: 15 }}>Country Configuration</h3>
              <p style={{ margin: 0, color: isCountryConfigured ? '#065f46' : '#92400e', fontSize: 14, fontWeight: 500 }}>
                {isCountryConfigured
                  ? '✔ Country is configured and ready'
                  : '⚠ Country configuration incomplete. Contact support.'}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
