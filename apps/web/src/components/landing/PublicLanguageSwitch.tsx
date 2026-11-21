import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../contexts/AuthContext';
import { EnglishLangFlag, HebrewLangFlag } from '../public/PublicLanguageFlags';
import '../../styles/nx-public-shell.css';

export function PublicLanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const auth = useAuth();

  const select = (code: 'en' | 'he') => {
    if (code === lang) return;
    if (auth.status !== 'authenticated') {
      setLang(code);
      return;
    }
    void auth.setUiLanguage(code).then((refreshed) => {
      const next = refreshed?.sidebar_account_block?.language_selector?.current_value;
      if (next === 'en' || next === 'he' || next === 'ru') setLang(next);
      else setLang(code);
    }).catch(() => {
      setLang(code);
    });
  };

  return (
    <div
      className={`nx-public-lang${compact ? ' nx-public-lang--compact' : ''} nx-landing__lang`}
      role="group"
      aria-label={t('landing.lang.aria')}
      data-testid="public-language-switch"
    >
      <button
        type="button"
        className={`nx-public-lang__btn${lang === 'en' ? ' is-selected' : ''}`}
        aria-pressed={lang === 'en'}
        aria-label={t('landing.lang.en')}
        title={t('landing.lang.en')}
        onClick={() => select('en')}
      >
        <EnglishLangFlag />
        <span className="nx-public-sr-only">{t('landing.lang.en')}</span>
      </button>
      <button
        type="button"
        className={`nx-public-lang__btn${lang === 'he' ? ' is-selected' : ''}`}
        aria-pressed={lang === 'he'}
        aria-label={t('landing.lang.he')}
        title={t('landing.lang.he')}
        onClick={() => select('he')}
      >
        <HebrewLangFlag />
        <span className="nx-public-sr-only">{t('landing.lang.he')}</span>
      </button>
    </div>
  );
}
