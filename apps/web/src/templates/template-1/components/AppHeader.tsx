import { useMemo, useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';

export function AppHeader({
  organizations,
  activeOrganizationId,
  onSelectOrg,
  user,
  onSignOut,
}: {
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  onSelectOrg: (id: string) => Promise<void> | void;
  user: { email: string; fullName: string | null };
  onSignOut: () => Promise<void> | void;
}) {
  const { lang, setLang, t } = useI18n();
  const [orgOpen, setOrgOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const activeOrg = useMemo(() => organizations.find((o) => o.id === activeOrganizationId) ?? null, [
    organizations,
    activeOrganizationId,
  ]);

  return (
    <header
      style={{
        height: 64,
        borderBottom: '1px solid #E5E7EB',
        background: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        gap: 16,
      }}
    >
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOrgOpen((o) => !o)}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid #D1D5DB',
            background: '#FFFFFF',
            cursor: 'pointer',
            fontSize: 14,
            color: '#111827',
          }}
        >
          {activeOrg?.name ?? 'Select organization'}
        </button>
        {orgOpen && (
          <ul
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              margin: 0,
              padding: 8,
              listStyle: 'none',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(16,24,40,0.06)',
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              minWidth: 220,
              zIndex: 20,
            }}
          >
            {organizations.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOrgOpen(false);
                    void onSelectOrg(org.id);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#111827',
                  }}
                >
                  {org.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6B7280' }}>
          <span>{t('topBar.language')}</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value === 'he' ? 'he' : 'en')}
            style={{
              padding: '0 10px',
              height: 34,
              borderRadius: 10,
              border: '1px solid #D1D5DB',
              fontSize: 14,
              background: '#FFFFFF',
              color: '#111827',
              cursor: 'pointer',
            }}
          >
            <option value="en">EN</option>
            <option value="he">HE</option>
          </select>
        </label>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((o) => !o)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid #D1D5DB',
              background: '#FFFFFF',
              cursor: 'pointer',
              fontSize: 14,
              color: '#111827',
            }}
          >
            {user.fullName || user.email}
          </button>
          {userMenuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                background: '#FFFFFF',
                border: '1px solid #E5E7EB',
                boxShadow: '0 1px 2px rgba(16,24,40,0.06)',
                padding: 8,
                borderRadius: 12,
                minWidth: 180,
                zIndex: 20,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  void onSignOut();
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: '#111827',
                }}
              >
                {t('topBar.signOut')}
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}

