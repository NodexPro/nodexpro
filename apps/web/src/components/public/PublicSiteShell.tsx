import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';
import '../../styles/nx-landing.css';
import '../../styles/nx-public-shell.css';

export function PublicSiteShell({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  return (
    <div className="nx-landing nx-public-shell" dir={dir} lang={lang} data-testid="nx-landing">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  );
}
