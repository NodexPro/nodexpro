import { Link } from 'react-router-dom';
import logoSrc from '../templates/template-1/assets/nodexpro-logo.png';
import { LandingModuleShowcase } from '../components/landing/LandingModuleShowcase';
import { PublicLanguageSwitch } from '../components/landing/PublicLanguageSwitch';
import { useI18n } from '../i18n/I18nProvider';
import '../styles/nx-landing.css';
import '../styles/nx-glass-surface.css';

const MODULES = ['work_engine', 'accounting', 'invoices', 'clients', 'documents', 'tax_brain'] as const;

export function LandingPage() {
  const { t, lang } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const year = String(new Date().getFullYear());

  return (
    <div className="nx-landing" dir={dir} lang={lang} data-testid="nx-landing">
      <header className="nx-landing__header">
        <div className="nx-landing__header-inner">
          <Link to="/" className="nx-landing__brand" aria-label={t('landing.brandHome')}>
            <img className="nx-landing__logo" src={logoSrc} alt="NodexPro" />
          </Link>
          <div className="nx-landing__header-actions">
            <PublicLanguageSwitch compact />
            <nav className="nx-landing__nav" aria-label={t('landing.navAria')}>
              <Link to="/login" className="nx-landing__btn nx-landing__btn--ghost">
                {t('landing.login')}
              </Link>
              <Link to="/register" className="nx-landing__btn nx-landing__btn--primary">
                {t('landing.signIn')}
              </Link>
            </nav>
          </div>
        </div>
        <div className="nx-landing__horizon" aria-hidden />
      </header>

      <section className="nx-landing__hero" aria-label={t('landing.heroAria')}>
        <div className="nx-landing__hero-stage">
          <div className="nx-landing__hero-content">
            <h1 className="nx-landing__hero-title">
              {t('landing.heroTitleLead')}
              <br />
              {t('landing.heroTitleTail')}
              <span className="nx-landing__hero-accent">.</span>
            </h1>
            <p className="nx-landing__hero-lead">{t('landing.heroLead')}</p>
            <div className="nx-landing__hero-actions">
              <Link to="/register" className="nx-landing__btn nx-landing__btn--primary">
                {t('landing.getStarted')}
              </Link>
              <Link to="/login" className="nx-landing__btn nx-landing__btn--ghost">
                {t('landing.login')}
              </Link>
            </div>
          </div>
          <div className="nx-landing__hero-art" aria-hidden />
        </div>
      </section>

      <LandingModuleShowcase />

      <section className="nx-landing__modules" aria-labelledby="nx-landing-modules-heading">
        <div className="nx-landing__modules-inner">
          <p className="nx-landing__eyebrow">{t('landing.eyebrow')}</p>
          <h2 id="nx-landing-modules-heading" className="nx-landing__modules-title">
            {t('landing.modulesTitleLead')}
            <br />
            {t('landing.modulesTitleTail')}
          </h2>
          <div className="nx-landing__module-grid">
            {MODULES.map((key) => (
              <article key={key} className="nx-landing__module-card">
                <h3 className="nx-landing__module-name">{t(`landing.modules.${key}.title`)}</h3>
                <p className="nx-landing__module-desc">{t(`landing.modules.${key}.description`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="nx-landing__footer">
        <p className="nx-landing__footer-copy">{t('landing.footerCopy').replace('{year}', year)}</p>
      </footer>
    </div>
  );
}
