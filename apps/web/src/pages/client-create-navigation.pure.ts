/** Canonical Core client id from the create-client command response. */

export function canonicalCreatedClientId(created: { id?: unknown } | null | undefined): string | null {
  const id = typeof created?.id === 'string' ? created.id.trim() : '';
  return id || null;
}

export function clientCardPath(clientId: string): string {
  return `/clients/${clientId}`;
}

/**
 * After Core create_client: always stay in Client Operations and open the existing
 * workspace modal (same as the registry folder action). Never `/clients/:id`.
 */
export function createdClientDestination(params: {
  currentPath?: string;
  clientId: string;
}): { kind: 'client_operations_modal'; clientId: string } {
  void params.currentPath;
  return { kind: 'client_operations_modal', clientId: params.clientId };
}

/** Presentation bootstrap for the CO workspace modal after Core create (not business truth). */
export type CreatedClientOpenLocationState = {
  openClientId: string;
  openClientName?: string | null;
  openClientTaxId?: string | null;
  openClientEmail?: string | null;
  openClientPhone?: string | null;
};

function optionalContact(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

export function createdClientOpenLocationState(params: {
  clientId: string;
  displayName?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
}): CreatedClientOpenLocationState {
  return {
    openClientId: params.clientId,
    openClientName: optionalContact(params.displayName),
    openClientTaxId: optionalContact(params.taxId),
    openClientEmail: optionalContact(params.email),
    openClientPhone: optionalContact(params.phone),
  };
}

export function parseCreatedClientOpenLocationState(state: unknown): CreatedClientOpenLocationState | null {
  if (!state || typeof state !== 'object') return null;
  const rec = state as Record<string, unknown>;
  const openClientId = typeof rec.openClientId === 'string' ? rec.openClientId.trim() : '';
  if (!openClientId) return null;
  return {
    openClientId,
    openClientName: optionalContact(typeof rec.openClientName === 'string' ? rec.openClientName : null),
    openClientTaxId: optionalContact(typeof rec.openClientTaxId === 'string' ? rec.openClientTaxId : null),
    openClientEmail: optionalContact(typeof rec.openClientEmail === 'string' ? rec.openClientEmail : null),
    openClientPhone: optionalContact(typeof rec.openClientPhone === 'string' ? rec.openClientPhone : null),
  };
}
