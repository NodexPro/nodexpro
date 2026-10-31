import { Link } from 'react-router-dom';
import { LandingModuleShowcase } from '../components/landing/LandingModuleShowcase';
import { LandingSecurityTrust } from '../components/landing/LandingSecurityTrust';
import { PublicSiteShell } from '../components/public/PublicSiteShell';
import { useI18n } from '../i18n/I18nProvider';
import '../styles/nx-landing.css';
import '../styles/nx-glass-surface.css';

const MODULES = ['work_engine', 'accounting', 'invoices', 'clients', 'documents', 'tax_brain'] as const;

export function LandingPage() {
  const { t } = useI18n();

  return (
    <PublicSiteShell>
      <section className="nx-landing__hero" aria-label={t('landing.heroAria')}>
        <div className="nx-landing__hero-content">
          <h1 className="nx-landing__hero-title">
            <span className="nx-landing__hero-title-text">{`${t('landing.heroTitleLead')} ${t('landing.heroTitleTail')}`}<span className="nx-landing__hero-accent">.</span></span>
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

      <LandingSecurityTrust />
    </PublicSiteShell>
  );
}
