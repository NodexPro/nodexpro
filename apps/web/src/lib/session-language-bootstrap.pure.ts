/**
 * Authenticated UI language:
 * - persisted users.ui_language wins (second device / TOKEN_REFRESHED)
 * - otherwise stored public lang wins (do not flash EN over a HE first visit)
 * - otherwise session resolved lang
 * Never writes. TOKEN_REFRESHED uses the same function.
 */

import { isStoredUiLang } from './public-ui-lang.pure';

export type BootstrapUiLang = 'en' | 'he' | 'ru';

export function decideSessionLanguageApply(input: {
  storedPublicLang?: string | null;
  sessionLang?: string | null;
  sessionPersisted?: boolean;
}): BootstrapUiLang | null {
  if (input.sessionPersisted && isStoredUiLang(input.sessionLang)) return input.sessionLang;
  if (isStoredUiLang(input.storedPublicLang)) return input.storedPublicLang;
  if (isStoredUiLang(input.sessionLang)) return input.sessionLang;
  return null;
}
