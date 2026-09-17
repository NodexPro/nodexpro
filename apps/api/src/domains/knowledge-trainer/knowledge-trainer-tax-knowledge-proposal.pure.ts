export const TAX_KNOWLEDGE_PROPOSAL_STATUSES = [
  'proposed',
  'needs_review',
  'owner_approved',
  'rejected',
  'published_to_canonical_draft',
] as const;

export type TaxKnowledgeProposalStatus = (typeof TAX_KNOWLEDGE_PROPOSAL_STATUSES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_CREATION_ORIGINS = ['ai_proposal', 'owner_corrected'] as const;
export type TaxKnowledgeProposalCreationOrigin = (typeof TAX_KNOWLEDGE_PROPOSAL_CREATION_ORIGINS)[number];

/** Command-layer review transitions. Stricter than the 636 open-state DB guard. */
export const TAX_KNOWLEDGE_PROPOSAL_REVIEW_TRANSITIONS: Record<
  TaxKnowledgeProposalStatus,
  readonly TaxKnowledgeProposalStatus[]
> = {
  proposed: ['needs_review', 'owner_approved', 'rejected'],
  needs_review: ['owner_approved', 'rejected'],
  owner_approved: [],
  rejected: [],
  published_to_canonical_draft: [],
};

export const TAX_KNOWLEDGE_PROPOSAL_TRUSTED_PROVENANCE_FIELDS = [
  'document_id',
  'tax_source_id',
  'structure_run_id',
  'revision_no',
  'status',
  'published_tax_rule_id',
  'published_tax_rule_version_id',
  'published_tax_legal_node_id',
] as const;

export function isTaxKnowledgeProposalStatus(value: unknown): value is TaxKnowledgeProposalStatus {
  return typeof value === 'string' && (TAX_KNOWLEDGE_PROPOSAL_STATUSES as readonly string[]).includes(value);
}

export function isTaxKnowledgeProposalCreationOrigin(value: unknown): value is TaxKnowledgeProposalCreationOrigin {
  return typeof value === 'string' && (TAX_KNOWLEDGE_PROPOSAL_CREATION_ORIGINS as readonly string[]).includes(value);
}

export function allowedTaxKnowledgeProposalReviewStatuses(
  status: string,
): TaxKnowledgeProposalStatus[] {
  if (!isTaxKnowledgeProposalStatus(status)) return [];
  return [...TAX_KNOWLEDGE_PROPOSAL_REVIEW_TRANSITIONS[status]];
}

export function canSetTaxKnowledgeProposalReviewStatus(from: string, to: string): boolean {
  return allowedTaxKnowledgeProposalReviewStatuses(from).includes(to as TaxKnowledgeProposalStatus);
}

export function taxKnowledgeProposalStatusLabel(status: string): string {
  switch (status) {
    case 'proposed':
      return 'Proposed / מוצע';
    case 'needs_review':
      return 'Needs review / לסקירה';
    case 'owner_approved':
      return 'Owner approved / אושר על ידי Owner';
    case 'rejected':
      return 'Rejected / נדחה';
    case 'published_to_canonical_draft':
      return 'Published to canonical draft / פורסם לטיוטת קנון';
    default:
      return status;
  }
}

export function nextProposalRevisionNo(currentMax: number | null | undefined): number {
  return (typeof currentMax === 'number' && Number.isFinite(currentMax) ? currentMax : 0) + 1;
}

export function pickLatestTaxKnowledgeProposal<T extends { revision_no: number }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return rows.reduce((latest, row) => (row.revision_no > latest.revision_no ? row : latest));
}

export function pickSelectedTaxKnowledgeProposal<T extends { id: string; revision_no: number }>(
  rows: T[],
  requestedId?: string | null,
): T | null {
  if (requestedId) {
    const match = rows.find((row) => row.id === requestedId);
    if (match) return match;
  }
  return pickLatestTaxKnowledgeProposal(rows);
}

export function taxKnowledgeProposalAllowedActions(input: {
  hasSelectedDraft: boolean;
  selectedProposalStatus: string | null;
}): {
  create_tax_knowledge_proposal: boolean;
  set_tax_knowledge_proposal_review_status: boolean;
  create_corrected_tax_knowledge_proposal: boolean;
} {
  const next = input.selectedProposalStatus
    ? allowedTaxKnowledgeProposalReviewStatuses(input.selectedProposalStatus)
    : [];
  return {
    create_tax_knowledge_proposal: input.hasSelectedDraft,
    set_tax_knowledge_proposal_review_status: next.length > 0,
    create_corrected_tax_knowledge_proposal: Boolean(input.selectedProposalStatus),
  };
}

export function isProposalRevisionConflictError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return code === '23505' || /monotonic per legal_text_draft_id/i.test(message);
}

export function proposalJsonIsObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
