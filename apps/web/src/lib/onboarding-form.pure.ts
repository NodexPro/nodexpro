/**
 * Onboarding field helpers. Options come from the session localization aggregate.
 */

export function firstLocalizationOptionValue(
  options: Array<{ code?: string; value?: string }> | null | undefined,
): string {
  const first = options?.[0];
  if (!first) return '';
  const code = typeof first.code === 'string' ? first.code.trim() : '';
  if (code) return code;
  return typeof first.value === 'string' ? first.value.trim() : '';
}

export function localizationValueAllowed(
  value: string | null | undefined,
  options: Array<{ code?: string; value?: string }> | null | undefined,
): boolean {
  const selected = String(value ?? '').trim();
  if (!selected) return false;
  return (options ?? []).some((option) => option.code === selected || option.value === selected);
}
