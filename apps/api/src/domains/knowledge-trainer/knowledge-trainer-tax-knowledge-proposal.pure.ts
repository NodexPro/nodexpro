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
  selectedDraftReviewStatus?: string | null;
  selectedProposalStatus: string | null;
}): {
  create_tax_knowledge_proposal: boolean;
  generate_tax_knowledge_proposal: boolean;
  set_tax_knowledge_proposal_review_status: boolean;
  create_corrected_tax_knowledge_proposal: boolean;
  ensure_tax_knowledge_proposal_owner_presentations: boolean;
} {
  const next = input.selectedProposalStatus
    ? allowedTaxKnowledgeProposalReviewStatuses(input.selectedProposalStatus)
    : [];
  return {
    create_tax_knowledge_proposal: input.hasSelectedDraft,
    generate_tax_knowledge_proposal:
      input.hasSelectedDraft &&
      input.selectedDraftReviewStatus === 'ready' &&
      !input.selectedProposalStatus,
    set_tax_knowledge_proposal_review_status: next.length > 0,
    create_corrected_tax_knowledge_proposal: Boolean(input.selectedProposalStatus),
    ensure_tax_knowledge_proposal_owner_presentations: Boolean(input.selectedProposalStatus),
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

export const TAX_KNOWLEDGE_PROPOSAL_RULE_TEXT_CORRECTION_KEYS = [
  'proposal_rule_key',
  'title',
  'statement',
  'notes',
] as const;

export type TaxKnowledgeProposalRuleTextCorrection = {
  proposal_rule_key: string;
  title?: string;
  statement?: string;
  notes?: string | null;
};

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseTaxKnowledgeProposalRuleTextCorrections(
  value: unknown,
): TaxKnowledgeProposalRuleTextCorrection[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: TaxKnowledgeProposalRuleTextCorrection[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    if (Object.keys(rec).some((key) => !(TAX_KNOWLEDGE_PROPOSAL_RULE_TEXT_CORRECTION_KEYS as readonly string[]).includes(key))) {
      return null;
    }
    const proposal_rule_key = asTrimmedString(rec.proposal_rule_key);
    if (!proposal_rule_key) return null;
    const row: TaxKnowledgeProposalRuleTextCorrection = { proposal_rule_key };
    if ('title' in rec) {
      if (typeof rec.title !== 'string') return null;
      row.title = rec.title;
    }
    if ('statement' in rec) {
      if (typeof rec.statement !== 'string') return null;
      row.statement = rec.statement;
    }
    if ('notes' in rec) {
      if (rec.notes !== null && typeof rec.notes !== 'string') return null;
      row.notes = rec.notes;
    }
    if (!('title' in row) && !('statement' in row) && !('notes' in row)) return null;
    rows.push(row);
  }
  return rows;
}

export function applyTaxKnowledgeProposalRuleTextCorrections(
  proposalJson: Record<string, unknown>,
  corrections: TaxKnowledgeProposalRuleTextCorrection[],
): { ok: true; proposal_json: Record<string, unknown> } | { ok: false; message: string } {
  if (!corrections.length) return { ok: false, message: 'rule_text_corrections is required' };
  let cloned: Record<string, unknown>;
  try {
    cloned = JSON.parse(JSON.stringify(proposalJson)) as Record<string, unknown>;
  } catch {
    return { ok: false, message: 'proposal_json must be JSON-safe' };
  }
  const rules = Array.isArray(cloned.rules) ? cloned.rules : null;
  if (!rules) return { ok: false, message: 'proposal_json.rules must be an array' };
  for (const correction of corrections) {
    const match = rules.find((row) => {
      return Boolean(row && typeof row === 'object' && !Array.isArray(row) && asTrimmedString((row as Record<string, unknown>).proposal_rule_key) === correction.proposal_rule_key);
    });
    if (!match || typeof match !== 'object' || Array.isArray(match)) {
      return { ok: false, message: `unknown proposal_rule_key: ${correction.proposal_rule_key}` };
    }
    const rule = match as Record<string, unknown>;
    if (correction.title !== undefined) rule.title = correction.title;
    if (correction.statement !== undefined) rule.statement = correction.statement;
    if (correction.notes !== undefined) rule.notes = correction.notes;
  }
  return { ok: true, proposal_json: cloned };
}
