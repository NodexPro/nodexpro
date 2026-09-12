export type OwnerCountryOption = {
  code: string;
  name: string;
  status?: string;
};

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeStatus(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Union of backend country lists. Does not invent countries. */
export function mergeOwnerCountrySelectorOptions(
  ...lists: Array<ReadonlyArray<OwnerCountryOption>>
): OwnerCountryOption[] {
  const map = new Map<string, OwnerCountryOption>();
  for (const list of lists) {
    for (const row of list) {
      const code = normalizeCode(row.code);
      if (!code) continue;
      const name = row.name.trim() || code;
      const status = normalizeStatus(row.status) || undefined;
      const prev = map.get(code);
      const nextStatus = status ?? prev?.status;
      const next: OwnerCountryOption = nextStatus ? { code, name, status: nextStatus } : { code, name };
      if (!prev || (prev.name === prev.code && name !== code)) {
        map.set(code, next);
      } else {
        map.set(code, nextStatus ? { ...prev, status: nextStatus } : prev);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Normal Owner selector: backend country status only. Never filter by name. */
export function activeOwnerCountrySelectorOptions(
  list: ReadonlyArray<OwnerCountryOption>,
): OwnerCountryOption[] {
  return list.filter((row) => (row.status ?? 'active').trim().toLowerCase() === 'active');
}

function displayNameOf(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function isoAlpha2Catalog(): string[] {
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') {
      const regions = supported.call(Intl, 'region').filter((code) => /^[A-Z]{2}$/.test(code));
      if (regions.length) return regions;
    }
  } catch {
    // Some runtimes expose supportedValuesOf but reject the 'region' key.
  }
  const codes: string[] = [];
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      const label = displayNameOf(code);
      if (label && label !== code) codes.push(code);
    }
  }
  return codes;
}

/**
 * Presentation-only ISO 3166-1 alpha-2 picker from the runtime Intl catalog.
 * Not legal truth. Existing backend countries are excluded.
 */
export function ownerIsoRegionPickerOptions(existingCodes: readonly string[]): OwnerCountryOption[] {
  const existing = new Set(existingCodes.map(normalizeCode).filter(Boolean));
  return isoAlpha2Catalog()
    .filter((code) => !existing.has(code))
    .map((code) => ({ code, name: displayNameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
