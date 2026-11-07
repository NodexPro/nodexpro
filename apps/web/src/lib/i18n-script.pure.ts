let activeUiLang = 'en';

export function setActiveUiLang(lang: string): void {
  activeUiLang = lang === 'he' || lang === 'ru' ? lang : 'en';
}

export function getActiveUiLang(): string {
  return activeUiLang;
}

const HEBREW_RE = /[\u0590-\u05FF]/;
const LATIN_WORD_RE = /[A-Za-z]{3,}/;

const ALLOWED_EXACT = new Set([
  'DocFlow',
  'Nodex',
  'NodexPro',
  'Nodex Pro',
  'PCN',
  'VAT',
  'ID',
  'SLA',
  'ILS',
  'USD',
  'EUR',
  'PDF',
  'CSV',
  'HP',
  'MFA',
  'API',
  'SMS',
  'OTP',
  'OK',
  'MM/YY',
  'NI',
  'IT',
  'עברית',
  'English',
]);

export function textHasHebrew(value: string): boolean {
  return HEBREW_RE.test(value);
}

function isAllowedException(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (ALLOWED_EXACT.has(trimmed)) return true;
  if (/^[A-Z]{2,5}$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9][A-Za-z0-9 .,'’+\-/]*\s*\([^)]*[\u0590-\u05FF][^)]*\)$/.test(trimmed)) return true;
  if (/^Nodex(\s+Pro)?(\s+clients)?$/i.test(trimmed)) return true;
  return false;
}

/** Skip a published overlay value that would paint the wrong alphabet onto the active UI language. */
export function overlayValueAllowedForLocale(value: string, locale: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isAllowedException(trimmed)) return true;
  if (locale === 'en') {
    if (!HEBREW_RE.test(trimmed)) return true;
    return /^[A-Za-z0-9][A-Za-z0-9 .,'’+\-/]*\s*\([^)]*[\u0590-\u05FF][^)]*\)$/.test(trimmed);
  }
  if (locale === 'he') {
    if (HEBREW_RE.test(trimmed)) return true;
    return !LATIN_WORD_RE.test(trimmed);
  }
  return true;
}
