export function resolveKnowledgeTrainerSelectedDocumentId(params: {
  requestedDocumentId?: string | null;
  persistedDocumentId?: string | null;
  inventoryIds: string[];
}): string | null {
  const inventory = new Set(params.inventoryIds.filter(Boolean));
  const requested = typeof params.requestedDocumentId === 'string' ? params.requestedDocumentId.trim() : '';
  if (requested && inventory.has(requested)) return requested;
  const persisted = typeof params.persistedDocumentId === 'string' ? params.persistedDocumentId.trim() : '';
  if (persisted && inventory.has(persisted)) return persisted;
  return null;
}
