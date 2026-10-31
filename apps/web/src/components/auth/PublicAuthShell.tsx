import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { PublicLanguageSwitch } from '../landing/PublicLanguageSwitch';
import logoSrc from '../../templates/template-1/assets/nodexpro-logo.png';
import '../../styles/nx-glass-surface.css';
import '../../styles/nx-office-deep-ocean.css';

export function PublicAuthShell({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  const { lang } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';

  return (
    <div
      className="nx-glass-auth nx-office-ocean nx-register-ocean"
      data-testid={testId}
      dir={dir}
      lang={lang}
    >
      <div className="nx-glass-auth__lang">
        <PublicLanguageSwitch compact />
      </div>
      <div className="nx-glass-card nx-glass-auth__card">
        <div className="nx-glass-auth__brand">
          <img className="nx-glass-auth__logo" src={logoSrc} alt="NodexPro" />
          <h1 className="nx-glass-title">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
