import { TAX_SOURCE_PROVENANCE_TYPES } from '../tax-knowledge/tax-knowledge.types.js';

export const KNOWLEDGE_TRAINER_COMMANDS = [
  'upload_legal_training_document',
  'start_legal_document_extraction',
  'retry_legal_document_page',
  'update_legal_extraction_candidate',
  'accept_legal_structure_candidate',
  'reject_legal_extraction_candidate',
] as const;

export type KnowledgeTrainerCommandName = (typeof KNOWLEDGE_TRAINER_COMMANDS)[number];

export function isKnowledgeTrainerCommand(command: string): command is KnowledgeTrainerCommandName {
  return (KNOWLEDGE_TRAINER_COMMANDS as readonly string[]).includes(command);
}

export const LEGAL_INGESTION_INPUT_TYPES = ['pdf', 'image', 'text'] as const;
export type LegalIngestionInputType = (typeof LEGAL_INGESTION_INPUT_TYPES)[number];

export const LEGAL_INGESTION_JOB_STATUSES = [
  'uploaded',
  'queued',
  'extracting',
  'partially_extracted',
  'ready_for_review',
  'needs_review',
  'extraction_failed',
  'reviewed',
  'cancelled',
] as const;
export type LegalIngestionJobStatus = (typeof LEGAL_INGESTION_JOB_STATUSES)[number];

export const LEGAL_INGESTION_PAGE_STATUSES = [
  'pending',
  'extracting',
  'extracted',
  'needs_ocr',
  'failed',
] as const;
export type LegalIngestionPageStatus = (typeof LEGAL_INGESTION_PAGE_STATUSES)[number];

export const LEGAL_INGESTION_CANDIDATE_KINDS = [
  'structure',
  'rule',
  'legal_value',
  'reference',
  'fact',
] as const;
export type LegalIngestionCandidateKind = (typeof LEGAL_INGESTION_CANDIDATE_KINDS)[number];

export const LEGAL_INGESTION_CANDIDATE_STATUSES = [
  'proposed',
  'needs_review',
  'accepted',
  'rejected',
] as const;
export type LegalIngestionCandidateStatus = (typeof LEGAL_INGESTION_CANDIDATE_STATUSES)[number];

export const OWNER_LEGAL_MATERIALS_BUCKET = 'owner-legal-materials';
export const OWNER_LEGAL_MATERIALS_MAX_BYTES = 50 * 1024 * 1024;
export const V1_ENABLED_INPUT_TYPE: LegalIngestionInputType = 'pdf';
export const V1_PDF_MIME = 'application/pdf';
export const MALWARE_SCAN_STATUS_V1 = 'not_implemented' as const;

export const KNOWLEDGE_TRAINER_PROVENANCE_TYPES = TAX_SOURCE_PROVENANCE_TYPES;

export const WORKER_ALLOWED_TABLES = [
  'legal_ingestion_documents',
  'legal_ingestion_jobs',
  'legal_ingestion_pages',
  'legal_ingestion_candidates',
] as const;

export const WORKER_FORBIDDEN_CANONICAL_TABLES = [
  'tax_domains',
  'tax_sources',
  'tax_legal_nodes',
  'tax_rules',
  'tax_rule_versions',
  'country_legal_values',
  'country_legal_value_versions',
  'tax_fact_definitions',
] as const;

export type KnowledgeTrainerCommandResponse = {
  ok: true;
  command: KnowledgeTrainerCommandName;
  duplicate?: boolean;
  refreshed: {
    aggregate_key: 'owner_legal_control_panel_aggregate';
    aggregate: Record<string, unknown>;
  };
};

export type StructureKindCatalogItem = {
  id: string;
  label: string;
};

export type ExtractedPageText = {
  page_no: number;
  text: string;
};

export type StructureCandidateDraft = {
  candidate_kind: 'structure';
  candidate_status: LegalIngestionCandidateStatus;
  kind_label: string;
  node_number: string | null;
  title: string | null;
  parent_index: number | null;
  page_start: number;
  page_end: number;
  excerpt: string;
  confidence: number;
  validation_warnings: string[];
};

export type KnowledgeTrainerInputOptionDto = {
  input_type: LegalIngestionInputType;
  available: boolean;
  label: string;
  status_label: string;
};

export type KnowledgeTrainerDocumentSummaryDto = {
  id: string;
  tax_source_id: string;
  original_filename: string;
  input_type: LegalIngestionInputType;
  provenance_type: string;
  page_count: number;
  extracted_page_count: number;
  needs_ocr_page_count: number;
  failed_page_count: number;
  structure_candidate_count: number;
  job_status: LegalIngestionJobStatus;
  job_status_label: string;
  duplicate_of_existing: boolean;
};

export type KnowledgeTrainerPageSummaryDto = {
  page_no: number;
  status: LegalIngestionPageStatus;
  has_text: boolean;
};

export type KnowledgeTrainerCandidateDto = {
  id: string;
  candidate_kind: LegalIngestionCandidateKind;
  candidate_status: LegalIngestionCandidateStatus;
  kind_label: string | null;
  node_number: string | null;
  title: string | null;
  parent_candidate_id: string | null;
  parent_tax_legal_node_id: string | null;
  page_start: number | null;
  page_end: number | null;
  excerpt: string | null;
  confidence: number | null;
  validation_warnings: string[];
  matched_tax_legal_node_id: string | null;
  accepted_tax_legal_node_id: string | null;
  possible_existing_match: boolean;
};

export type KnowledgeTrainerSliceDto = {
  available: boolean;
  schema_applied: boolean;
  status_label: string;
  malware_scanning: 'not_implemented';
  input_options: KnowledgeTrainerInputOptionDto[];
  documents: KnowledgeTrainerDocumentSummaryDto[];
  selected_document: {
    id: string;
    original_filename: string;
    job_status: LegalIngestionJobStatus;
    job_status_label: string;
    page_count: number;
    extracted_page_count: number;
    needs_ocr_page_count: number;
    failed_page_count: number;
    structure_candidate_count: number;
    pages: KnowledgeTrainerPageSummaryDto[];
    selected_page: { page_no: number; text: string | null; status: LegalIngestionPageStatus } | null;
    candidates: KnowledgeTrainerCandidateDto[];
    can_open_original: boolean;
  } | null;
  allowed_actions: Array<{
    action_key: string;
    enabled: boolean;
    required_fields: Record<string, string>;
  }>;
};
