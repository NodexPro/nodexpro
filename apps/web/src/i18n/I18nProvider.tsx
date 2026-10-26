import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import en from './en.json';
import he from './he.json';
import ru from './ru.json';

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

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('lang') : null;
    if (stored === 'he' || stored === 'ru') return stored;
    return 'en';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('lang', lang);
    }
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
