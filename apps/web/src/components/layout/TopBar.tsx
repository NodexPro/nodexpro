import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';

interface Org {
  id: string;
  name: string;
}

interface User {
  email: string;
  fullName: string | null;
}

export function TopBar({
  organizations,
  activeOrganizationId,
  onSelectOrg,
  user,
  onSignOut,
}: {
  organizations: Org[];
  activeOrganizationId: string | null;
  onSelectOrg: (id: string) => void;
  user: User;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const activeOrg = organizations.find((o) => o.id === activeOrganizationId);
  const { lang, setLang, t } = useI18n();

  return (
    <header style={{ height: 56, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
      <div style={{ position: 'relative' }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ padding: '8px 12px' }}>
          {activeOrg?.name ?? 'Select organization'}
        </button>
        {open && (
          <ul style={{ position: 'absolute', top: '100%', left: 0, margin: 0, padding: 8, listStyle: 'none', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', minWidth: 200 }}>
            {organizations.map((org) => (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => { onSelectOrg(org.id); setOpen(false); }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px' }}
                >
                  {org.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <span>{t('topBar.language')}</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value === 'he' ? 'he' : 'en')}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
          >
            <option value="en">EN</option>
            <option value="he">HE</option>
          </select>
        </label>
        <div style={{ position: 'relative' }}>
          <button type="button" onClick={() => setUserMenuOpen((o) => !o)}>
            {user.fullName || user.email}
          </button>
          {userMenuOpen && (
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', padding: 8 }}>
              <button type="button" onClick={() => { onSignOut(); setUserMenuOpen(false); }}>{t('topBar.signOut')}</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
