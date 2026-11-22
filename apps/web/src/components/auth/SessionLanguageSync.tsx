import { useLayoutEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import { PUBLIC_LANG_STORAGE_KEY } from '../../lib/public-ui-lang.pure';
import { decideSessionLanguageApply } from '../../lib/session-language-bootstrap.pure';

/** Apply persisted session language before paint. TOKEN_REFRESHED does not write. */
export function SessionLanguageSync() {
  const auth = useAuth();
  const { lang, setLang } = useI18n();

  useLayoutEffect(() => {
    if (auth.status !== 'authenticated') return;
    const sessionLang =
      auth.me.sidebar_account_block?.language_selector?.current_value
      ?? auth.me.localization?.language?.current;
    const stored =
      typeof window === 'undefined' ? null : window.localStorage.getItem(PUBLIC_LANG_STORAGE_KEY);
    const next = decideSessionLanguageApply({
      storedPublicLang: stored,
      sessionLang,
      sessionPersisted: auth.me.localization?.language?.persisted === true,
    });
    if (next && next !== lang) setLang(next);
  }, [auth, lang, setLang]);

  return null;
}
