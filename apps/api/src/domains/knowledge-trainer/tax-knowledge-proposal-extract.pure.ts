import { createHash } from 'node:crypto';
import { badRequest, conflict } from '../../shared/errors.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_CONTRACT,
  TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
} from './tax-knowledge-proposal-v1.types.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_SYSTEM,
  wrapUntrustedLegalData,
} from './tax-knowledge-proposal-extract-v1.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GENERATE_TAX_KNOWLEDGE_PROPOSAL_FORBIDDEN_FIELDS = [
  'prompt',
  'messages',
  'system',
  'provider',
  'model',
  'proposal_json',
  'generation_metadata',
  'generation_metadata_json',
  'country_code',
  'document_id',
  'tax_source_id',
  'structure_run_id',
  'creation_origin',
  'revision_no',
  'status',
  'published_tax_rule_id',
  'published_tax_rule_version_id',
  'published_tax_legal_node_id',
  'tax_rule_id',
  'tax_legal_node_id',
  'draft_ids',
  'legal_text_draft_ids',
  'candidates',
] as const;

export const CONTROLLED_CONTEXT_FORBIDDEN_KEYS = [
  'api_key',
  'secret',
  'prompt',
  'completion',
  'pdf_bytes',
  'file_base64',
  'storage_key',
  'candidates',
  'client',
  'tenant',
  'income',
  'payroll',
  'invoice',
  'value_payload_json',
  'statutory_rate',
  'statutory_amount',
  'statutory_ceiling',
] as const;

export const MATCHED_LEGAL_NODE_LIMIT = 24;
export const FACT_DEFINITION_LIMIT = 400;
export const LEGAL_VALUE_KEY_LIMIT = 400;
export const ANCESTOR_LIMIT = 12;

export type GenerateDraftRow = {
  id: string;
  country_code: string;
  document_id: string;
  tax_source_id: string;
  structure_run_id: string | null;
  parent_draft_id: string | null;
  review_status: string;
  kind_label: string | null;
  title: string | null;
  source_display_identifier: string | null;
  normalized_machine_identifier: string | null;
  printed_marker: string | null;
  draft_legal_text: string | null;
};

export type ControlledExtractionContext = {
  prompt_contract_version: string;
  purpose: string;
  output_contract: string;
  output_schema_version: number;
  draft: {
    id: string;
    country_code: string;
    tax_source_id: string;
    kind_label: string | null;
    title: string | null;
    source_display_identifier: string | null;
    normalized_machine_identifier: string | null;
    printed_marker: string | null;
    draft_legal_text: string;
  };
  ancestors: Array<{
    id: string;
    kind_label: string | null;
    title: string | null;
    source_display_identifier: string | null;
    normalized_machine_identifier: string | null;
    draft_legal_text: string;
  }>;
  existing_legal_nodes: Array<{
    id: string;
    title: string | null;
    source_display_identifier: string | null;
    normalized_machine_identifier: string | null;
    node_number: string | null;
    status: string | null;
    matched_from: 'draft' | 'ancestor';
  }>;
  canonical_allowlist: {
    tax_legal_node_ids: string[];
    tax_source_ids: string[];
  };
  tax_fact_definitions: Array<{
    fact_key: string;
    country_code: string | null;
    value_type: string | null;
    enum_codes: string[];
  }>;
  country_legal_value_keys: Array<{ value_key: string }>;
  relationship_vocabulary: string[];
  k3_predicate_contract: Record<string, unknown>;
  k4_calculation_hook_contract: Record<string, unknown>;
  output_contract_keys: string[];
  extraction_outcomes: string[];
  bounds: {
    matched_legal_nodes: number;
    fact_definitions: number;
    legal_value_keys: number;
    ancestors: number;
  };
};

export function parseGenerateTaxKnowledgeProposalDraftId(payload: Record<string, unknown>): string {
  for (const field of GENERATE_TAX_KNOWLEDGE_PROPOSAL_FORBIDDEN_FIELDS) {
    if (field in payload && payload[field] !== undefined) {
      throw badRequest(`${field} is resolved by the backend and cannot be supplied`);
    }
  }
  const raw = payload.legal_text_draft_id ?? payload.draft_id;
  if (typeof raw !== 'string' || !UUID_RE.test(raw.trim())) {
    throw badRequest('legal_text_draft_id is required');
  }
  const extra = Object.keys(payload).filter(
    (key) => key !== 'legal_text_draft_id' && key !== 'draft_id' && payload[key] !== undefined,
  );
  if (extra.length) {
    throw badRequest('generate_tax_knowledge_proposal accepts legal_text_draft_id only');
  }
  return raw.trim();
}

export function assertDraftReadyForAiExtraction(draft: Pick<GenerateDraftRow, 'review_status' | 'draft_legal_text'>): void {
  if (draft.review_status !== 'ready') {
    throw conflict('Owner Draft must have review_status = ready', 'TAX_KNOWLEDGE_PROPOSAL_DRAFT_NOT_READY');
  }
  if (!String(draft.draft_legal_text ?? '').trim()) {
    throw conflict(
      'Owner Draft has insufficient legal text for extraction',
      'TAX_KNOWLEDGE_PROPOSAL_INSUFFICIENT_EVIDENCE',
    );
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export type LegalNodeMatchQuery = {
  matched_from: 'draft' | 'ancestor';
  normalized_machine_identifier: string | null;
  source_display_identifier: string | null;
};

export function legalNodeMatchQueriesForExtraction(
  draft: Pick<GenerateDraftRow, 'normalized_machine_identifier' | 'source_display_identifier'>,
  ancestors: Array<Pick<ControlledExtractionContext['ancestors'][number], 'normalized_machine_identifier' | 'source_display_identifier'>>,
): LegalNodeMatchQuery[] {
  return [
    {
      matched_from: 'draft',
      normalized_machine_identifier: draft.normalized_machine_identifier,
      source_display_identifier: draft.source_display_identifier,
    },
    ...ancestors.map((ancestor) => ({
      matched_from: 'ancestor' as const,
      normalized_machine_identifier: ancestor.normalized_machine_identifier,
      source_display_identifier: ancestor.source_display_identifier,
    })),
  ];
}

export function buildCanonicalAllowlist(input: {
  existing_legal_nodes: Array<{ id: string }>;
  tax_source_id: string;
}): ControlledExtractionContext['canonical_allowlist'] {
  const tax_legal_node_ids: string[] = [];
  for (const node of input.existing_legal_nodes) {
    if (!tax_legal_node_ids.includes(node.id)) tax_legal_node_ids.push(node.id);
  }
  return {
    tax_legal_node_ids,
    tax_source_ids: input.tax_source_id ? [input.tax_source_id] : [],
  };
}

export function digestControlledExtractionInput(context: ControlledExtractionContext): string {
  return sha256Hex(stableJson(context));
}

export function collectObjectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return into;
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, into);
    return into;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    into.add(key);
    collectObjectKeys(nested, into);
  }
  return into;
}

export function controlledContextContainsForbiddenKey(context: ControlledExtractionContext): string | null {
  const keys = collectObjectKeys(context);
  for (const forbidden of CONTROLLED_CONTEXT_FORBIDDEN_KEYS) {
    if (keys.has(forbidden)) return forbidden;
  }
  return null;
}

export function buildExtractUserMessage(context: ControlledExtractionContext): string {
  return wrapUntrustedLegalData(stableJson(context));
}

export function buildExtractSystemMessage(): string {
  return TAX_KNOWLEDGE_PROPOSAL_EXTRACT_SYSTEM;
}

export function buildGenerationMetadataJson(input: {
  provider: string;
  model: string;
  generatedAt: string;
  inputContextDigest: string;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    provider: input.provider,
    model: input.model,
    prompt_contract_version: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
    output_contract: TAX_KNOWLEDGE_PROPOSAL_CONTRACT,
    output_schema_version: TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    input_context_digest: input.inputContextDigest,
  };
}

const TAX_639_AUDIT_ERROR_MAX = 80;
const TAX_639_AUDIT_PATH_MAX = 240;
const TAX_639_AUDIT_CODE_MAX = 80;
const TAX_639_AUDIT_MESSAGE_MAX = 400;

export type SanitizedTax639AuditError = {
  path: string;
  code: string;
  message: string;
};

/** TAX-639 audit/UI diagnostics: keep path/code/message only. Never store proposal JSON, quotes, or completions. */
export function sanitizeTax639AuditErrors(errors: unknown): SanitizedTax639AuditError[] {
  if (!Array.isArray(errors)) return [];
  const out: SanitizedTax639AuditError[] = [];
  for (const row of errors) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const path = typeof rec.path === 'string' ? rec.path.trim() : '';
    const code = typeof rec.code === 'string' ? rec.code.trim() : '';
    const message = typeof rec.message === 'string' ? rec.message.trim() : '';
    if (!path && !code && !message) continue;
    out.push({
      path: path.slice(0, TAX_639_AUDIT_PATH_MAX),
      code: code.slice(0, TAX_639_AUDIT_CODE_MAX),
      message: message.slice(0, TAX_639_AUDIT_MESSAGE_MAX),
    });
    if (out.length >= TAX_639_AUDIT_ERROR_MAX) break;
  }
  return out;
}

export function sanitizeGenerateAuditPayload(input: {
  legal_text_draft_id: string;
  proposal_id?: string | null;
  revision_no?: number | null;
  supersedes_proposal_id?: string | null;
  provider?: string | null;
  model?: string | null;
  prompt_contract_version?: string | null;
  output_contract?: string | null;
  output_schema_version?: number | null;
  latency_ms?: number | null;
  outcome: string;
  input_context_digest?: string | null;
  attempt_count?: number | null;
  errors?: unknown;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    legal_text_draft_id: input.legal_text_draft_id,
    proposal_id: input.proposal_id ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    prompt_contract_version: input.prompt_contract_version ?? TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
    output_contract: input.output_contract ?? TAX_KNOWLEDGE_PROPOSAL_CONTRACT,
    output_schema_version: input.output_schema_version ?? TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
    latency_ms: input.latency_ms ?? null,
    outcome: input.outcome,
    input_context_digest: input.input_context_digest ?? null,
    attempt_count: input.attempt_count ?? null,
    purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
  };
  if (input.revision_no != null) payload.revision_no = input.revision_no;
  if (input.supersedes_proposal_id != null) payload.supersedes_proposal_id = input.supersedes_proposal_id;
  if (input.outcome === 'tax_639_invalid') {
    payload.errors = sanitizeTax639AuditErrors(input.errors);
  }
  return payload;
}
