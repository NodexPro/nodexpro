import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';

/** Apply the persisted session language. Does not invent a locale from country or browser. */
export function SessionLanguageSync() {
  const auth = useAuth();
  const { lang, setLang } = useI18n();

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const next = auth.me.sidebar_account_block?.language_selector?.current_value;
    if ((next === 'en' || next === 'he' || next === 'ru') && next !== lang) {
      setLang(next);
    }
  }, [auth, lang, setLang]);

  return null;
}
