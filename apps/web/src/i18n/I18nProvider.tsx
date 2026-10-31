import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import en from './en.json';
import he from './he.json';
import ru from './ru.json';
import {
  PUBLIC_GEO_COUNTRY_COOKIE,
  PUBLIC_LANG_STORAGE_KEY,
  buildLangCookie,
  parseCookieValue,
  resolvePublicUiLang,
} from '../lib/public-ui-lang.pure';

export type Lang = 'en' | 'he' | 'ru';

type Messages = typeof en;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

function lookup(dict: unknown, key: string): string | undefined {
  const parts = key.split('.');
  let value: unknown = dict;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

const translations: Record<Lang, Messages | Record<string, unknown>> = {
  en,
  he,
  ru,
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function persistUiLang(next: Lang): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PUBLIC_LANG_STORAGE_KEY, next);
  }
  if (typeof document !== 'undefined') {
    document.cookie = buildLangCookie(next);
  }
}

function readInitialUiLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored =
    window.localStorage.getItem(PUBLIC_LANG_STORAGE_KEY) ??
    parseCookieValue(document.cookie, PUBLIC_LANG_STORAGE_KEY) ??
    parseCookieValue(document.cookie, 'nx-lang');
  const geoCountry = parseCookieValue(document.cookie, PUBLIC_GEO_COUNTRY_COOKIE);
  return resolvePublicUiLang({ stored, geoCountry });
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readInitialUiLang());

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    }
    persistUiLang(lang);
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
  };

  const t = useMemo(
    () => (key: string): string => lookup(translations[lang], key) ?? lookup(en, key) ?? key,
    [lang],
  );

  const value: I18nContextValue = { lang, setLang, t };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
