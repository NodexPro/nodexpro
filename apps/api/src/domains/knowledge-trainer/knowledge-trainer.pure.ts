import { createHash } from 'node:crypto';
import {
  KNOWLEDGE_TRAINER_PROVENANCE_TYPES,
  LEGAL_INGESTION_CANDIDATE_KINDS,
  LEGAL_INGESTION_INPUT_TYPES,
  OWNER_LEGAL_MATERIALS_MAX_BYTES,
  V1_ENABLED_INPUT_TYPE,
  V1_PDF_MIME,
  type ExtractedPageText,
  type KnowledgeTrainerInputOptionDto,
  type LegalIngestionInputType,
  type StructureCandidateDraft,
  type StructureKindCatalogItem,
} from './knowledge-trainer.types.js';

const PDF_MAGIC = Buffer.from('%PDF');

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sanitizeOriginalFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename.trim() : '';
  const base = raw.replace(/[/\\]/g, '').replace(/\0/g, '').slice(0, 240);
  return base || 'legal-material.pdf';
}

export function buildRandomizedStorageKey(countryCode: string, taxSourceId: string, documentId: string): string {
  return `${countryCode.toUpperCase()}/${taxSourceId}/${documentId}`;
}

export function trainerInputOptions(v1Enabled: boolean): KnowledgeTrainerInputOptionDto[] {
  return [
    {
      input_type: 'pdf',
      available: v1Enabled,
      label: 'PDF',
      status_label: v1Enabled ? 'Available' : 'Coming next',
    },
    {
      input_type: 'image',
      available: false,
      label: 'Photos',
      status_label: 'Coming next',
    },
    {
      input_type: 'text',
      available: false,
      label: 'Text',
      status_label: 'Coming next',
    },
  ];
}

export function assertV1PdfUpload(input: {
  input_type: unknown;
  mime_type: unknown;
  bytes: Buffer;
}): { input_type: 'pdf'; mime_type: typeof V1_PDF_MIME } {
  const inputType = typeof input.input_type === 'string' ? input.input_type.trim() : V1_ENABLED_INPUT_TYPE;
  if (inputType !== 'pdf') {
    throw Object.assign(new Error('V1 accepts selectable-text PDF only'), { code: 'UNSUPPORTED_INPUT_TYPE' });
  }
  const mime = typeof input.mime_type === 'string' ? input.mime_type.trim().toLowerCase() : '';
  if (mime !== V1_PDF_MIME) {
    throw Object.assign(new Error('Unsupported MIME type'), { code: 'UNSUPPORTED_MIME' });
  }
  if (input.bytes.length > OWNER_LEGAL_MATERIALS_MAX_BYTES) {
    throw Object.assign(new Error('File too large'), { code: 'FILE_TOO_LARGE' });
  }
  if (input.bytes.length < 5 || !input.bytes.subarray(0, 4).equals(PDF_MAGIC)) {
    throw Object.assign(new Error('File is not a PDF'), { code: 'INVALID_PDF_MAGIC' });
  }
  return { input_type: 'pdf', mime_type: V1_PDF_MIME };
}

export function isKnownInputType(value: unknown): value is LegalIngestionInputType {
  return typeof value === 'string' && (LEGAL_INGESTION_INPUT_TYPES as readonly string[]).includes(value);
}

export function isKnownCandidateKind(value: unknown): boolean {
  return typeof value === 'string' && (LEGAL_INGESTION_CANDIDATE_KINDS as readonly string[]).includes(value);
}

export function isKnownProvenanceType(value: unknown): boolean {
  return typeof value === 'string' && (KNOWLEDGE_TRAINER_PROVENANCE_TYPES as readonly string[]).includes(value);
}

export function pageHasUsableEmbeddedText(text: string | null | undefined): boolean {
  return Boolean(text && text.replace(/\s+/g, '').length > 0);
}

export function jobStatusLabel(status: string): string {
  switch (status) {
    case 'uploaded':
      return 'Uploaded';
    case 'queued':
      return 'Queued';
    case 'extracting':
      return 'Processing';
    case 'partially_extracted':
      return 'Partially extracted';
    case 'ready_for_review':
      return 'Ready for review';
    case 'needs_review':
      return 'Needs review';
    case 'extraction_failed':
      return 'Extraction failed';
    case 'reviewed':
      return 'Reviewed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function kindPattern(labels: string[]): string {
  return labels
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

export function parseNumericIdentifier(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

/**
 * Deterministic structure headings from extracted page text.
 * Kind labels come from the country catalog — never a frontend hardcoded list.
 * Parentage follows document order, not a universal hierarchy.
 */
export function extractStructureCandidatesFromPages(
  pages: ExtractedPageText[],
  catalog: StructureKindCatalogItem[],
): StructureCandidateDraft[] {
  const labels = catalog.map((item) => item.label.trim()).filter(Boolean);
  if (!labels.length) return [];
  const pattern = new RegExp(`(?:^|\\n)\\s*(${kindPattern(labels)})\\s+([^\\n]{0,240})`, 'g');
  const found: StructureCandidateDraft[] = [];
  const stack: Array<{ index: number; kind_label: string }> = [];

  for (const page of pages) {
    const text = page.text ?? '';
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const kindLabel = match[1];
      const rest = normalizeHeadingText(match[2] ?? '');
      const numberMatch = rest.match(/^(\S+)(?:\s+[—\-–:]?\s*(.*))?$/);
      const nodeNumber = numberMatch?.[1] ? numberMatch[1].replace(/[.:]$/, '') : null;
      const title = numberMatch?.[2] ? normalizeHeadingText(numberMatch[2]) : null;
      const excerpt = normalizeHeadingText(`${kindLabel} ${rest}`).slice(0, 400);

      let existingKindAt = -1;
      for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
        if (stack[stackIndex].kind_label === kindLabel) {
          existingKindAt = stackIndex;
          break;
        }
      }
      if (existingKindAt >= 0) {
        stack.splice(existingKindAt);
      }
      const parent = stack.length ? stack[stack.length - 1] : null;
      const draft: StructureCandidateDraft = {
        candidate_kind: 'structure',
        candidate_status: 'proposed',
        kind_label: kindLabel,
        node_number: nodeNumber,
        title,
        parent_index: parent ? parent.index : null,
        page_start: page.page_no,
        page_end: page.page_no,
        excerpt,
        confidence: title ? 0.72 : 0.55,
        validation_warnings: [],
      };
      found.push(draft);
      stack.push({ index: found.length - 1, kind_label: kindLabel });
    }
  }
  return found;
}

export function validateStructureCandidates(
  drafts: StructureCandidateDraft[],
  context: {
    country_code: string;
    tax_source_id: string;
    existing_nodes: Array<{
      id: string;
      tax_source_id: string;
      country_code: string;
      kind_label: string;
      node_number: string | null;
      title: string;
    }>;
  },
): StructureCandidateDraft[] {
  const out = drafts.map((draft) => ({
    ...draft,
    validation_warnings: [...draft.validation_warnings],
    candidate_status: draft.candidate_status,
  }));

  const parentByIndex = new Map<number, number | null>();
  out.forEach((draft, index) => parentByIndex.set(index, draft.parent_index));

  for (let i = 0; i < out.length; i += 1) {
    const draft = out[i];
    if (draft.parent_index != null) {
      if (draft.parent_index < 0 || draft.parent_index >= out.length || draft.parent_index === i) {
        draft.validation_warnings.push('invalid_parent_candidate');
        draft.candidate_status = 'needs_review';
      } else if (hasParentCycle(i, parentByIndex)) {
        draft.validation_warnings.push('hierarchy_cycle');
        draft.candidate_status = 'needs_review';
      }
    }

    const siblings = out.filter(
      (other, otherIndex) =>
        otherIndex !== i &&
        other.kind_label === draft.kind_label &&
        other.parent_index === draft.parent_index &&
        other.node_number &&
        draft.node_number &&
        other.node_number === draft.node_number,
    );
    if (siblings.length) {
      draft.validation_warnings.push('duplicate_sibling_identifier');
      draft.candidate_status = 'needs_review';
    }

    const exactDup = out.some(
      (other, otherIndex) =>
        otherIndex < i &&
        other.kind_label === draft.kind_label &&
        other.node_number === draft.node_number &&
        other.parent_index === draft.parent_index &&
        other.title === draft.title,
    );
    if (exactDup) {
      draft.validation_warnings.push('duplicate_candidate');
      draft.candidate_status = 'needs_review';
    }

    const existing = context.existing_nodes.find(
      (node) =>
        node.tax_source_id === context.tax_source_id &&
        node.country_code === context.country_code &&
        node.kind_label === draft.kind_label &&
        Boolean(node.node_number) &&
        node.node_number === draft.node_number,
    );
    if (existing) {
      draft.validation_warnings.push('possible_existing_canonical_node');
      draft.candidate_status = 'needs_review';
    }
  }

  const groups = new Map<string, Array<{ index: number; n: number }>>();
  out.forEach((draft, index) => {
    const n = parseNumericIdentifier(draft.node_number);
    if (n == null) return;
    const key = `${draft.kind_label}::${draft.parent_index ?? 'root'}`;
    const list = groups.get(key) ?? [];
    list.push({ index, n });
    groups.set(key, list);
  });
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => a.n - b.n);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].n > sorted[i - 1].n + 1) {
        const draft = out[sorted[i].index];
        draft.validation_warnings.push('sequence_anomaly');
        draft.candidate_status = 'needs_review';
      }
    }
  }

  return out;
}

export function hasParentCycle(start: number, parentByIndex: Map<number, number | null>): boolean {
  const seen = new Set<number>();
  let current: number | null | undefined = start;
  while (current != null) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentByIndex.get(current);
  }
  return false;
}

/** Proof that later photo/text batches map onto the same page model. */
export function orderedPagesFromFutureInputs(input: {
  input_type: LegalIngestionInputType;
  items: Array<{ order: number; text?: string | null }>;
}): Array<{ page_no: number; extraction_method: 'ocr' | 'manual_text'; text: string | null; status: 'pending' }> {
  return input.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      page_no: index + 1,
      extraction_method: input.input_type === 'text' ? 'manual_text' : 'ocr',
      text: item.text ?? null,
      status: 'pending' as const,
    }));
}

export function summarizeJobProgress(pages: Array<{ status: string }>): {
  extracted_page_count: number;
  needs_ocr_page_count: number;
  failed_page_count: number;
  job_status: 'extracting' | 'partially_extracted' | 'ready_for_review' | 'needs_review' | 'extraction_failed';
} {
  const extracted_page_count = pages.filter((page) => page.status === 'extracted').length;
  const needs_ocr_page_count = pages.filter((page) => page.status === 'needs_ocr').length;
  const failed_page_count = pages.filter((page) => page.status === 'failed').length;
  const pending = pages.filter((page) => page.status === 'pending' || page.status === 'extracting').length;
  if (pending > 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'extracting' };
  }
  if (extracted_page_count === 0 && needs_ocr_page_count === 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'extraction_failed' };
  }
  if (failed_page_count > 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'partially_extracted' };
  }
  if (needs_ocr_page_count > 0) {
    return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'needs_review' };
  }
  return { extracted_page_count, needs_ocr_page_count, failed_page_count, job_status: 'ready_for_review' };
}

export function workerMustNotWriteCanonicalLaw(table: string): boolean {
  return [
    'tax_domains',
    'tax_sources',
    'tax_legal_nodes',
    'tax_rules',
    'tax_rule_versions',
    'country_legal_values',
    'country_legal_value_versions',
    'tax_fact_definitions',
  ].includes(table);
}

export function assertCountryAgrees(entityCountry: string, payloadCountry: unknown): void {
  if (typeof payloadCountry !== 'string' || !payloadCountry.trim()) return;
  if (payloadCountry.trim().toUpperCase() !== entityCountry.toUpperCase()) {
    throw Object.assign(new Error('Country on payload does not match the tax source'), {
      code: 'COUNTRY_MISMATCH',
    });
  }
}

export function safeAuditExcerpt(value: string | null | undefined, max = 80): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}
