import { getActiveUiLang, overlayValueAllowedForLocale, textHasHebrew } from './i18n-script.pure';

/** Render backend-owned `label_key` through the existing I18nProvider overlay. */
export function localizeSystemLabel(
  t: (key: string) => string,
  labelKey: string | null | undefined,
  fallback: string,
  locale?: string,
): string {
  const lang = locale ?? getActiveUiLang();
  if (labelKey) {
    const translated = t(labelKey);
    if (translated && translated !== labelKey) return translated;
  }
  if (fallback && !overlayValueAllowedForLocale(fallback, lang)) {
    return labelKey ? t(labelKey) : fallback;
  }
  if (!labelKey) return fallback;
  if (lang === 'en' && textHasHebrew(fallback)) return labelKey;
  return fallback;
}

export function fillI18n(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  return out;
}

/** Resolve `label_key` plus `{{var}}` fills; optional param keys translate interpolated chrome. */
export function localizeFilledLabel(
  t: (key: string) => string,
  labelKey: string | null | undefined,
  fallback: string,
  params?: Record<string, string | number>,
  paramKeys?: Record<string, string>,
): string {
  const filled: Record<string, string | number> = { ...(params ?? {}) };
  for (const [name, key] of Object.entries(paramKeys ?? {})) {
    filled[name] = localizeSystemLabel(t, key, String(filled[name] ?? ''));
  }
  return fillI18n(localizeSystemLabel(t, labelKey, fallback), filled);
}

export type AccountingSummaryPrimaryEntry = {
  text_he: string;
  label_he?: string;
  label_key?: string;
  type_he?: string | null;
  type_key?: string | null;
  suffix?: string | null;
  amount_display?: string | null;
  fill_key?: string;
  fill_params?: Record<string, string | number>;
};

/** Render backend-owned accounting summary chrome. Amounts and user suffix stay as given. */
export function formatAccountingSummaryPrimaryEntry(
  t: (key: string) => string,
  entry: AccountingSummaryPrimaryEntry,
  locale?: string,
): string {
  if (entry.fill_key) {
    return localizeFilledLabel(t, entry.fill_key, entry.text_he, entry.fill_params, undefined);
  }
  const label = localizeSystemLabel(t, entry.label_key, entry.label_he ?? entry.text_he, locale);
  const type = entry.type_key || entry.type_he
    ? localizeSystemLabel(t, entry.type_key, entry.type_he ?? '', locale)
    : '';
  const inner = [type, entry.suffix].filter((part) => part && String(part).trim()).join(' / ');
  const core = inner ? `${label} (${inner})` : label;
  if (!entry.amount_display) return core;
  return localizeFilledLabel(
    t,
    'clientOperations.accounting.namedAmount',
    `${core} ${entry.amount_display}`,
    { label: core, amount: entry.amount_display },
  );
}
