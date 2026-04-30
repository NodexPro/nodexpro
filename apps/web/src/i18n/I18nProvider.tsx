import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import en from './en.json';
import he from './he.json';

type Lang = 'en' | 'he';

type Messages = typeof en;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const translations: Record<Lang, Messages> = {
  en,
  he,
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('lang') : null;
    return stored === 'he' ? 'he' : 'en';
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
    () => (key: string): string => {
      const dict = translations[lang] as any;
      const parts = key.split('.');
      let value: any = dict;
      for (const part of parts) {
        if (value == null) break;
        value = value[part];
      }
      return typeof value === 'string' ? value : key;
    },
    [lang]
  );

  const value: I18nContextValue = { lang, setLang, t };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

