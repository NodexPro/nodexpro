/** Canonical Core client id from the create-client command response. */

export function canonicalCreatedClientId(created: { id?: unknown } | null | undefined): string | null {
  const id = typeof created?.id === 'string' ? created.id.trim() : '';
  return id || null;
}

export function clientCardPath(clientId: string): string {
  return `/clients/${clientId}`;
}
