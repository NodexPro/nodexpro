import en from '../i18n/en.json';

export function lookupMessage(dict: unknown, key: string): string | undefined {
  const parts = key.split('.');
  let value: unknown = dict;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

export function englishSecurityText(key: string): string {
  return lookupMessage(en, key) ?? key;
}
