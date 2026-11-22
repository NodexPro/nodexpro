import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import { PUBLIC_LANG_STORAGE_KEY } from '../../lib/public-ui-lang.pure';
import { decideSessionLanguageApply } from '../../lib/session-language-bootstrap.pure';

/** Keep the public UI language across SIGNED_IN / TOKEN_REFRESHED / session bootstrap. */
export function SessionLanguageSync() {
  const auth = useAuth();
  const { lang, setLang } = useI18n();

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const sessionLang = auth.me.sidebar_account_block?.language_selector?.current_value;
    const stored =
      typeof window === 'undefined' ? null : window.localStorage.getItem(PUBLIC_LANG_STORAGE_KEY);
    const next = decideSessionLanguageApply({ storedPublicLang: stored, sessionLang });
    if (next && next !== lang) setLang(next);
  }, [auth, lang, setLang]);

  return null;
}
