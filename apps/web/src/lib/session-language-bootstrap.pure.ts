/**
 * Public UI language must survive SIGNED_IN, TOKEN_REFRESHED and session bootstrap.
 * Session language is applied only when the user has no stored public preference.
 */

import { isStoredUiLang } from './public-ui-lang.pure';

export type BootstrapUiLang = 'en' | 'he' | 'ru';

export function decideSessionLanguageApply(input: {
  storedPublicLang?: string | null;
  sessionLang?: string | null;
}): BootstrapUiLang | null {
  if (isStoredUiLang(input.storedPublicLang)) return input.storedPublicLang;
  if (isStoredUiLang(input.sessionLang)) return input.sessionLang;
  return null;
}
