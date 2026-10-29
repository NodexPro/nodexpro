/** Canonical Core client id from the create-client command response. */

export function canonicalCreatedClientId(created: { id?: unknown } | null | undefined): string | null {
  const id = typeof created?.id === 'string' ? created.id.trim() : '';
  return id || null;
}

export function clientCardPath(clientId: string): string {
  return `/clients/${clientId}`;
}

/**
 * After Core create_client: from Client Operations stay on the registry and open the
 * existing workspace modal. From Core /clients keep the Core card.
 */
export function createdClientDestination(params: {
  currentPath: string;
  clientId: string;
}): { kind: 'core_card'; path: string } | { kind: 'client_operations_modal'; clientId: string } {
  const path = String(params.currentPath ?? '').split('?')[0] ?? '';
  if (path === '/m/client-operations' || path.startsWith('/m/client-operations/')) {
    return { kind: 'client_operations_modal', clientId: params.clientId };
  }
  return { kind: 'core_card', path: clientCardPath(params.clientId) };
}
