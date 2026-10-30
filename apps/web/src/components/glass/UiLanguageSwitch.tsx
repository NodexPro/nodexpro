import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import '../../styles/nx-glass-surface.css';

export function UiLanguageSwitch({ ariaLabel, compact }: { ariaLabel?: string; compact?: boolean }) {
  const auth = useAuth();
  const { lang, setLang, t } = useI18n();
  const [busy, setBusy] = useState(false);

  const select = async (code: 'en' | 'he' | 'ru') => {
    if (code === lang || busy) return;
    setLang(code);
    if (auth.status !== 'authenticated') return;
    setBusy(true);
    try {
      const refreshed = await auth.setUiLanguage(code);
      const next = refreshed?.sidebar_account_block.language_selector.current_value;
      if (next === 'en' || next === 'he' || next === 'ru') setLang(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`nx-glass-lang${compact ? ' nx-glass-lang--compact' : ''}`}
      role="group"
      aria-label={ariaLabel ?? t('dashboard.lang.aria')}
    >
      <button
        type="button"
        className={`nx-glass-lang__btn${lang === 'en' ? ' is-selected' : ''}`}
        aria-pressed={lang === 'en'}
        disabled={busy}
        onClick={() => void select('en')}
      >
        {compact ? t('dashboard.lang.enCompact') : t('dashboard.lang.en')}
      </button>
      <button
        type="button"
        className={`nx-glass-lang__btn${lang === 'he' ? ' is-selected' : ''}`}
        aria-pressed={lang === 'he'}
        disabled={busy}
        onClick={() => void select('he')}
      >
        {compact ? t('dashboard.lang.heCompact') : t('dashboard.lang.he')}
      </button>
    </div>
  );
}
