/** Render backend-owned `label_key` through the existing I18nProvider overlay. */
export function localizeSystemLabel(
  t: (key: string) => string,
  labelKey: string | null | undefined,
  fallback: string,
): string {
  if (!labelKey) return fallback;
  const translated = t(labelKey);
  if (!translated || translated === labelKey) return fallback;
  return translated;
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
