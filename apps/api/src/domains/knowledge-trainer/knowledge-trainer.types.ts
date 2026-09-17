import { TAX_SOURCE_PROVENANCE_TYPES } from '../tax-knowledge/tax-knowledge.types.js';
import type { TaxKnowledgeProposalV1ValidationSummary } from './tax-knowledge-proposal-v1.types.js';

export const KNOWLEDGE_TRAINER_COMMANDS = [
  'upload_legal_training_document',
  'start_legal_document_extraction',
  'retry_legal_document_page',
  'rebuild_legal_structure_candidates',
  'reextract_legal_document_layout',
  'rebuild_legal_structure_with_layout',
  'update_legal_extraction_candidate',
  'accept_legal_structure_candidate',
  'reject_legal_extraction_candidate',
  'create_legal_text_draft_from_candidate',
  'prepare_legal_text_drafts_for_structure',
  'update_legal_text_draft_text',
  'update_legal_text_draft_identity',
  'reparent_legal_text_draft',
  'set_legal_text_draft_boundary',
  'reset_legal_text_draft_to_source',
  'set_legal_text_draft_review_status',
  'create_manual_legal_text_draft',
  'confirm_owner_structure_completeness',
  'retract_owner_structure_completeness',
  'create_tax_knowledge_proposal',
  'set_tax_knowledge_proposal_review_status',
  'create_corrected_tax_knowledge_proposal',
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
export const OWNER_LEGAL_MATERIAL_SIGNED_URL_EXPIRES_SEC = 1800;
export const OWNER_LEGAL_MATERIAL_SIGNED_URL_REFRESH_SKEW_SEC = 90;

export type OriginalFileAccessDto = {
  filename: string;
  url: string;
  expires_at: string;
  expires_in_sec: number;
};
export const V1_ENABLED_INPUT_TYPE: LegalIngestionInputType = 'pdf';
export const V1_PDF_MIME = 'application/pdf';
export const MALWARE_SCAN_STATUS_V1 = 'not_implemented' as const;

export const KNOWLEDGE_TRAINER_PROVENANCE_TYPES = TAX_SOURCE_PROVENANCE_TYPES;

export const WORKER_ALLOWED_TABLES = [
  'legal_ingestion_documents',
  'legal_ingestion_jobs',
  'legal_ingestion_pages',
  'legal_ingestion_candidates',
  'legal_ingestion_structure_runs',
  'legal_ingestion_source_notes',
  'legal_ingestion_source_note_anchors',
] as const;

export const SOURCE_NOTE_CLASSIFICATIONS = [
  'unknown',
  'legal_reference_candidate',
  'amendment_history',
  'publication_citation',
  'editorial_note',
  'other',
] as const;
export type SourceNoteClassification = (typeof SOURCE_NOTE_CLASSIFICATIONS)[number];

export const SOURCE_NOTE_ORIGIN_ZONES = ['apparatus_zone', 'body_line', 'footer_line'] as const;
export type SourceNoteOriginZone = (typeof SOURCE_NOTE_ORIGIN_ZONES)[number];

export const SOURCE_NOTE_REVIEW_STATUSES = ['needs_review', 'unresolved'] as const;
export type SourceNoteReviewStatus = (typeof SOURCE_NOTE_REVIEW_STATUSES)[number];

export const SOURCE_NOTE_INLINE_LINK_STATUSES = ['linked', 'unresolved', 'missing_anchor'] as const;
export type SourceNoteInlineLinkStatus = (typeof SOURCE_NOTE_INLINE_LINK_STATUSES)[number];

export const SOURCE_SPAN_IMMUTABLE_FIELDS = [
  'source_page',
  'source_item_start',
  'source_item_end',
  'source_line_index',
  'source_bbox',
] as const;

export type SourceBBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

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
  created_count?: number;
  skipped_existing_count?: number;
  remaining_count?: number;
  uncertain_count?: number;
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
  source_display_identifier?: string | null;
  normalized_machine_identifier?: string | null;
  identifier_base_number?: string | null;
  identifier_letter_suffix?: string | null;
  identifier_nested_components?: string[];
  printed_marker?: string | null;
  title: string | null;
  parent_index: number | null;
  page_start: number;
  page_end: number;
  excerpt: string;
  confidence: number;
  validation_warnings: string[];
  source_page?: number;
  source_line_index?: number;
  source_item_start?: number;
  source_item_end?: number;
  source_bbox?: SourceBBox;
};

export type SourceNoteAnchorDraft = {
  printed_marker: string;
  source_page: number;
  source_item_start: number | null;
  source_item_end: number | null;
  source_line_index: number | null;
  source_bbox: SourceBBox | null;
  link_status: 'linked' | 'unresolved';
  confidence: number;
};

export type SourceNoteDraft = {
  source_page: number;
  source_item_start: number | null;
  source_item_end: number | null;
  source_line_index: number | null;
  source_bbox: SourceBBox | null;
  printed_marker: string | null;
  note_text: string;
  classification: SourceNoteClassification;
  origin_zone: SourceNoteOriginZone;
  review_status: SourceNoteReviewStatus;
  inline_link_status: SourceNoteInlineLinkStatus;
  confidence: number;
  validation_warnings: string[];
  anchors: SourceNoteAnchorDraft[];
};

export type StructureDetectionAnalysis = {
  candidates_found: number;
  toc_index_rejected: number;
  low_confidence_count: number;
  unresolved_parent_count: number;
  ocr_pages_untouched: number;
  ocr_gap_warning: boolean;
  layout_used?: boolean;
  layout_pages_used?: number;
  source_occurrences_collapsed?: number;
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

export const STRUCTURE_REVIEW_CLASSES = [
  'high_confidence',
  'needs_owner_review',
  'rejected_technical',
] as const;
export type StructureReviewClass = (typeof STRUCTURE_REVIEW_CLASSES)[number];

export const STRUCTURE_REVIEW_FILTER_KEYS = [
  'all',
  'high_confidence',
  'needs_review',
  'ocr_affected',
  'rejected',
] as const;
export type StructureReviewFilterKey = (typeof STRUCTURE_REVIEW_FILTER_KEYS)[number];

export type KnowledgeTrainerCandidateDto = {
  id: string;
  candidate_kind: LegalIngestionCandidateKind;
  candidate_status: LegalIngestionCandidateStatus;
  kind_label: string | null;
  node_number: string | null;
  source_display_identifier?: string | null;
  normalized_machine_identifier?: string | null;
  identifier_base_number?: string | null;
  identifier_letter_suffix?: string | null;
  identifier_nested_components?: string[];
  printed_marker?: string | null;
  display_identifier: string | null;
  display_label: string;
  parent_display_identifier: string | null;
  title: string | null;
  parent_candidate_id: string | null;
  parent_tax_legal_node_id: string | null;
  page_start: number | null;
  page_end: number | null;
  source_page?: number | null;
  source_item_start?: number | null;
  source_item_end?: number | null;
  source_line_index?: number | null;
  source_bbox?: SourceBBox | null;
  excerpt: string | null;
  confidence: number | null;
  validation_warnings: string[];
  matched_tax_legal_node_id: string | null;
  accepted_tax_legal_node_id: string | null;
  sort_order?: number;
  possible_existing_match: boolean;
  review_class: StructureReviewClass;
  review_class_label: string;
  ocr_affected: boolean;
  review_warnings: string[];
  display_warnings: string[];
  parent_label: string | null;
  hierarchy_path: string;
  hierarchy_valid: boolean;
};

export type StructureReviewTreeNodeDto = {
  candidate_id: string;
  children: StructureReviewTreeNodeDto[];
};

export type StructureReviewFilterDto = {
  key: StructureReviewFilterKey;
  label: string;
  count: number;
};

export type StructureReviewSummaryDto = {
  all: number;
  high_confidence: number;
  needs_owner_review: number;
  ocr_affected: number;
  rejected_technical: number;
  already_rejected: number;
  already_accepted: number;
  by_kind: Record<string, number>;
};

export type StructureLayoutEvidenceDto = {
  heading_isolation_available: boolean;
  pdfjs_item_geometry_stored: boolean;
  stored_as: 'flattened_page_text' | 'multiline_page_text' | 'page_text_items';
  line_breaks_observed: number;
  status_label: string;
};

export type StructureRunReadDto = {
  schema_applied: boolean;
  active_run_id: string | null;
  active_status: string | null;
  detector_version: string | null;
  visible_candidate_count: number;
  building_run_id: string | null;
  building_status_label: string | null;
  last_failed_run_id: string | null;
  last_failed_reason: string | null;
  status_label: string;
};

export type TrainerLayoutReadinessDto = {
  readiness: 'not_extracted' | 'processing' | 'ready' | 'partial';
  readiness_label: string;
  eligible_count: number;
  ready_count: number;
  skipped_ocr_count: number;
  failed_count: number;
  item_count: number;
  high_confidence_trusted: boolean;
  reupload_required: false;
  reuse_document_label: string;
  can_extract_layout: boolean;
  can_rebuild_with_layout: boolean;
  pages: Array<{ page_no: number; layout_status: string; item_count: number }>;
};

export type KnowledgeTrainerSourceNoteAnchorDto = {
  id: string;
  printed_marker: string;
  source_page: number;
  source_item_start: number | null;
  source_item_end: number | null;
  source_line_index: number | null;
  source_bbox: SourceBBox | null;
  link_status: 'linked' | 'unresolved';
  confidence: number | null;
};

export type KnowledgeTrainerSourceNoteDto = {
  id: string;
  source_page: number;
  source_item_start: number | null;
  source_item_end: number | null;
  source_line_index: number | null;
  source_bbox: SourceBBox | null;
  printed_marker: string | null;
  note_text: string;
  classification: SourceNoteClassification;
  origin_zone: SourceNoteOriginZone;
  review_status: SourceNoteReviewStatus;
  inline_link_status: SourceNoteInlineLinkStatus;
  confidence: number | null;
  validation_warnings: string[];
  anchors: KnowledgeTrainerSourceNoteAnchorDto[];
};

export type KnowledgeTrainerSourceNoteSummaryDto = {
  all: number;
  apparatus_zone: number;
  body_line: number;
  footer_line: number;
  missing_anchor: number;
  linked: number;
  unresolved: number;
  by_classification: Record<SourceNoteClassification, number>;
};

export type KnowledgeTrainerLegalTextDraftListItemDto = {
  id: string;
  kind_label: string | null;
  display_identifier: string | null;
  display_label: string;
  printed_marker: string | null;
  title: string | null;
  parent_draft_id: string | null;
  parent_display_label: string | null;
  text_boundary_status: 'certain' | 'uncertain' | 'owner_defined';
  review_status: 'draft' | 'needs_review' | 'ready';
  source_page_start: number | null;
  source_page_end: number | null;
  unresolved_source_note_count: number;
  subtree_unresolved_source_note_count: number;
  provenance: {
    structure_run_id: string | null;
    source_candidate_id: string | null;
  };
  creation_origin: 'detector' | 'owner_manual';
  created_at: string;
  updated_at: string;
};

export type KnowledgeTrainerLegalTextDraftDto = {
  id: string;
  kind_label: string | null;
  display_identifier: string | null;
  display_label: string;
  printed_marker: string | null;
  title: string | null;
  parent_draft_id: string | null;
  parent_display_label: string | null;
  original_source_text: string;
  original_subtree_text: string | null;
  draft_legal_text: string;
  text_boundary_status: 'certain' | 'uncertain' | 'owner_defined';
  review_status: 'draft' | 'needs_review' | 'ready';
  source_page_start: number | null;
  source_page_end: number | null;
  source_item_start: number | null;
  source_item_end: number | null;
  subtree_page_start: number | null;
  subtree_page_end: number | null;
  subtree_item_start: number | null;
  subtree_item_end: number | null;
  owner_source_page_start: number | null;
  owner_source_page_end: number | null;
  owner_source_item_start: number | null;
  owner_source_item_end: number | null;
  provenance: {
    structure_run_id: string | null;
    source_candidate_id: string | null;
  };
  creation_origin: 'detector' | 'owner_manual';
  source_notes: KnowledgeTrainerSourceNoteDto[];
  unresolved_source_note_count: number;
  subtree_source_notes: KnowledgeTrainerSourceNoteDto[];
  subtree_unresolved_source_note_count: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeTrainerDraftCreateFrontierItemDto = {
  candidate_id: string;
  parent_candidate_id: string | null;
  parent_draft_id: string | null;
  parent_draft_required: boolean;
  kind_label: string | null;
  display_identifier: string | null;
  display_label: string;
};

export type KnowledgeTrainerLegalTextReviewState = 'not_prepared' | 'needs_review' | 'draft' | 'reviewed';

export type KnowledgeTrainerLegalTextReviewNodeDto = {
  id: string;
  draft_id: string | null;
  source_candidate_id: string | null;
  parent_id: string | null;
  kind_label: string | null;
  display_identifier: string | null;
  printed_marker: string | null;
  title: string | null;
  review_state: KnowledgeTrainerLegalTextReviewState;
  review_state_label: string;
  creation_origin: 'detector' | 'owner_manual';
  manually_added: boolean;
  search_label: string | null;
  ancestor_ids: string[];
  child_count: number;
  depth: number;
  default_expanded: boolean;
  tree_sort_key: number;
  review_progress: {
    all: number;
    reviewed: number;
    needs_review: number;
    draft: number;
    not_prepared: number;
  };
  structure_completeness_confirmed: boolean;
};

export type KnowledgeTrainerLegalTextSearchIndexItemDto = {
  node_id: string;
  search_label: string;
  ancestor_ids: string[];
};

export type KnowledgeTrainerLegalTextCompletenessDto = {
  document_confirmed: boolean;
  document_confirmed_at: string | null;
  selected_branch_confirmed: boolean;
  selected_branch_confirmed_at: string | null;
};

export type KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto = {
  id: string;
  revision_no: number;
  creation_origin: 'ai_proposal' | 'owner_corrected';
  status: 'proposed' | 'needs_review' | 'owner_approved' | 'rejected' | 'published_to_canonical_draft';
  status_label: string;
  supersedes_proposal_id: string | null;
  created_at: string;
  publication_trace: {
    published_tax_rule_id: string | null;
    published_tax_rule_version_id: string | null;
    published_tax_legal_node_id: string | null;
  };
};

export type KnowledgeTrainerTaxKnowledgeProposalDetailDto = KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto & {
  legal_text_draft_id: string;
  proposal_json: Record<string, unknown>;
  validation: TaxKnowledgeProposalV1ValidationSummary | null;
  allowed_next_statuses: KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto['status'][];
  allowed_actions: Array<{
    action_key: string;
    enabled: boolean;
    required_fields: Record<string, string>;
  }>;
};

export type KnowledgeTrainerTaxKnowledgeProposalSliceDto = {
  latest: KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto | null;
  selected: KnowledgeTrainerTaxKnowledgeProposalDetailDto | null;
  history: KnowledgeTrainerTaxKnowledgeProposalHistoryItemDto[];
};

export type KnowledgeTrainerLegalTextDraftSummaryDto = {
  all: number;
  draft: number;
  needs_review: number;
  ready: number;
  reviewed: number;
  not_prepared: number;
  structure_candidates: number;
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
    source_notes: KnowledgeTrainerSourceNoteDto[];
    source_note_summary: KnowledgeTrainerSourceNoteSummaryDto;
    unresolved_source_note_anchors: KnowledgeTrainerSourceNoteAnchorDto[];
    can_open_original: boolean;
    original_file_access: OriginalFileAccessDto | null;
    structure_analysis: StructureDetectionAnalysis | null;
    can_rebuild_structure: boolean;
    review_summary: StructureReviewSummaryDto;
    review_filters: StructureReviewFilterDto[];
    structure_tree: StructureReviewTreeNodeDto[];
    ocr_page_numbers: number[];
    layout_evidence: StructureLayoutEvidenceDto;
    layout_readiness: TrainerLayoutReadinessDto;
    structure_run: StructureRunReadDto;
    legal_text_drafts: KnowledgeTrainerLegalTextDraftListItemDto[];
    selected_legal_text_draft: KnowledgeTrainerLegalTextDraftDto | null;
    legal_text_draft_create_frontier: KnowledgeTrainerDraftCreateFrontierItemDto[];
    legal_text_draft_summary: KnowledgeTrainerLegalTextDraftSummaryDto;
    legal_text_review_tree: KnowledgeTrainerLegalTextReviewNodeDto[];
    selected_legal_text_review_node: KnowledgeTrainerLegalTextReviewNodeDto | null;
    legal_text_search_index: KnowledgeTrainerLegalTextSearchIndexItemDto[];
    legal_text_completeness: KnowledgeTrainerLegalTextCompletenessDto;
    tax_knowledge_proposals: KnowledgeTrainerTaxKnowledgeProposalSliceDto;
  } | null;
  allowed_actions: Array<{
    action_key: string;
    enabled: boolean;
    required_fields: Record<string, string>;
  }>;
};
