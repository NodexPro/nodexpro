import { Link } from 'react-router-dom';
import logoSrc from '../../templates/template-1/assets/nodexpro-logo.png';
import { PublicLanguageSwitch } from '../landing/PublicLanguageSwitch';
import { useI18n } from '../../i18n/I18nProvider';
import '../../styles/nx-public-shell.css';

export function PublicHeader() {
  const { t } = useI18n();

  return (
    <header className="nx-public-header nx-landing__header">
      <div className="nx-public-header__bar nx-landing__header-inner">
        <Link to="/" className="nx-public-header__brand nx-landing__brand" aria-label={t('landing.brandHome')}>
          <img className="nx-public-header__logo nx-landing__logo" src={logoSrc} alt="NodexPro" />
        </Link>
        <div className="nx-public-header__end nx-landing__header-actions">
          <PublicLanguageSwitch compact />
          <nav className="nx-public-header__nav nx-landing__nav" aria-label={t('landing.navAria')}>
            <Link to="/login" className="nx-landing__btn nx-landing__btn--ghost nx-public-header__btn">
              {t('landing.login')}
            </Link>
            <Link to="/register" className="nx-landing__btn nx-landing__btn--primary nx-public-header__btn">
              {t('landing.signIn')}
            </Link>
          </nav>
        </div>
      </div>
      <div className="nx-public-header__horizon nx-landing__horizon" aria-hidden />
    </header>
  );
}
