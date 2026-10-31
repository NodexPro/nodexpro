import { useI18n } from '../../i18n/I18nProvider';
import '../../styles/nx-glass-surface.css';

export function PublicLanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      className={`nx-glass-lang${compact ? ' nx-glass-lang--compact' : ''} nx-landing__lang`}
      role="group"
      aria-label={t('landing.lang.aria')}
      data-testid="public-language-switch"
    >
      <button
        type="button"
        className={`nx-glass-lang__btn${lang === 'en' ? ' is-selected' : ''}`}
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
      >
        {t('landing.lang.en')}
      </button>
      <button
        type="button"
        className={`nx-glass-lang__btn${lang === 'he' ? ' is-selected' : ''}`}
        aria-pressed={lang === 'he'}
        onClick={() => setLang('he')}
      >
        {t('landing.lang.he')}
      </button>
    </div>
  );
}
