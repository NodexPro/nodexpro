import { useEffect, useState, type CSSProperties } from 'react';
import { userFacingApiMessage } from '../api/client';
import { EmptyState } from '../templates/template-1/components/EmptyState';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import type {
  OwnerCountryPackRow,
  OwnerLegalLibraryNode,
  OwnerLegalLibrarySlice,
  OwnerLegalLibrarySource,
  OwnerLegalValueRow,
  OwnerRulesetRow,
  TaxKnowledgeAggregate,
  TaxKnowledgeAllowedAction,
  TaxKnowledgeCitation,
  TaxKnowledgeCountry,
  TaxKnowledgeLegalValueBinding,
  TaxKnowledgeRelationship,
  TaxKnowledgeRule,
  TaxKnowledgeUnresolvedLegalReference,
  TaxKnowledgeSource,
  TaxKnowledgeSupersessionPair,
  TaxKnowledgeVersion,
  UnknownRecord,
} from './owner-legal-control-types';
import {
  TAX_KNOWLEDGE_RELATIONSHIP_TYPES,
  emptyKnowledgeTrainerSlice,
  emptyLegalLibrarySlice,
  type OwnerKnowledgeTrainerCandidate,
  type OwnerKnowledgeTrainerDocument,
  type OwnerKnowledgeTrainerSlice,
} from './owner-legal-control-types';

import { emptyTaxKnowledgeAggregate } from './owner-legal-control-types';
import '../styles/nx-modal.css';
import '../templates/template-1/tokens.css';

const SCHEMA_NOT_APPLIED = 'tax_knowledge_schema_not_applied';

const TABLE_STYLE: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const TH_STYLE: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  padding: '8px 10px',
  color: '#6b7280',
  fontWeight: 600,
  fontSize: 12,
};

const TD_STYLE: CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
  padding: '8px 10px',
  color: '#111827',
  verticalAlign: 'top',
};

function asList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : String(value);
}

function parseSupersessionPairs(raw: unknown): TaxKnowledgeSupersessionPair[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      new_tax_rule_version_id: asString(row.new_tax_rule_version_id).trim(),
      old_tax_rule_version_id: asString(row.old_tax_rule_version_id).trim(),
    }))
    .filter((pair) => pair.new_tax_rule_version_id !== '' && pair.old_tax_rule_version_id !== '');
}

function parseAllowedActions(raw: unknown): TaxKnowledgeAllowedAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => {
      const payloadRaw = asRecord(row.payload);
      const payload: Record<string, string> = {};
      if (payloadRaw) {
        for (const [key, val] of Object.entries(payloadRaw)) {
          if (typeof val === 'string') payload[key] = val;
        }
      }
      const candidates = parseSupersessionPairs(row.candidates);
      return {
        action_key: asString(row.action_key),
        enabled: row.enabled !== false,
        payload,
        ...(candidates.length ? { candidates } : {}),
      };
    });
}

/** Presentation of the backend action DTO only. Does not scan sibling versions. */
function supersedePairsFromAction(action: TaxKnowledgeAllowedAction | null): TaxKnowledgeSupersessionPair[] {
  if (!action) return [];
  if (action.candidates && action.candidates.length) return action.candidates;
  const neu = (action.payload.new_tax_rule_version_id ?? '').trim();
  const old = (action.payload.old_tax_rule_version_id ?? '').trim();
  if (neu && old) return [{ new_tax_rule_version_id: neu, old_tax_rule_version_id: old }];
  return [];
}

function versionPresentationLabel(versionId: string, rules: TaxKnowledgeRule[]): string {
  for (const rule of rules) {
    const version = asList(rule.versions).find((row) => row.id === versionId);
    if (version) {
      return `${rule.rule_code} · version_no ${version.version_no} · ${version.status}`;
    }
  }
  return versionId;
}

function parseCountries(raw: unknown): TaxKnowledgeCountry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null && asString(row.code).trim() !== '')
    .map((row) => ({
      code: asString(row.code),
      name: asString(row.name) || asString(row.code),
      status: asString(row.status),
    }));
}

function parsePayloadObject(raw: unknown): UnknownRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as UnknownRecord;
}

function parseCitations(raw: unknown): TaxKnowledgeCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      tax_rule_version_id: asString(row.tax_rule_version_id),
      tax_source_id: asString(row.tax_source_id),
      source_code: asString(row.source_code),
      title: asString(row.title),
      provenance_type: asString(row.provenance_type),
      status: asString(row.status),
      locator: asNullableString(row.locator),
      created_at: asString(row.created_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseBindings(raw: unknown): TaxKnowledgeLegalValueBinding[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      tax_rule_version_id: asString(row.tax_rule_version_id),
      legal_value_id: asString(row.legal_value_id),
      value_key: asString(row.value_key),
      label: asString(row.label),
      category: asNullableString(row.category),
      module_scope: asNullableString(row.module_scope),
      status: asString(row.status),
      created_at: asString(row.created_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseLegalValuePickerRows(raw: unknown): OwnerLegalValueRow[] {
  const rec = asRecord(raw);
  const table = rec && Array.isArray(rec.table) ? rec.table : Array.isArray(raw) ? raw : [];
  return table
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null && asString(row.id).trim() !== '')
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      value_key: asString(row.value_key),
      label: asString(row.label),
      category: asNullableString(row.category),
      module_scope: asNullableString(row.module_scope),
      status: asString(row.status),
    }));
}

function parseRelationships(raw: unknown): TaxKnowledgeRelationship[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      from_tax_rule_version_id: asString(row.from_tax_rule_version_id),
      to_tax_rule_version_id: asString(row.to_tax_rule_version_id),
      relationship_type: asString(row.relationship_type),
      relationship_type_label: asString(row.relationship_type_label) || asString(row.relationship_type),
      activation_critical:
        row.activation_critical === true ? true : row.activation_critical === false ? false : null,
      activation_critical_label: asNullableString(row.activation_critical_label),
      status: asString(row.status),
      owner_note: asNullableString(row.owner_note),
      created_at: asString(row.created_at),
      to_tax_rule_id: asString(row.to_tax_rule_id),
      to_rule_code: asString(row.to_rule_code),
      to_title: asString(row.to_title),
      to_version_no: typeof row.to_version_no === 'number' ? row.to_version_no : Number(row.to_version_no) || 0,
      to_status: asString(row.to_status),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseVersion(row: UnknownRecord): TaxKnowledgeVersion {
  return {
    id: asString(row.id),
    tax_rule_id: asString(row.tax_rule_id),
    country_code: asString(row.country_code),
    version_no: typeof row.version_no === 'number' ? row.version_no : Number(row.version_no) || 0,
    status: asString(row.status),
    country_pack_id: asString(row.country_pack_id),
    country_pack_ruleset_id: asString(row.country_pack_ruleset_id),
    effective_from: asString(row.effective_from),
    effective_to: asNullableString(row.effective_to),
    payload_json: parsePayloadObject(row.payload_json),
    payload_checksum: asString(row.payload_checksum),
    supersedes_version_id: asNullableString(row.supersedes_version_id),
    superseded_by_version_id: asNullableString(row.superseded_by_version_id),
    retired_at: asNullableString(row.retired_at),
    retired_reason: asNullableString(row.retired_reason),
    created_at: asString(row.created_at),
    sources: parseCitations(row.sources),
    legal_value_bindings: parseBindings(row.legal_value_bindings),
    relationships: parseRelationships(row.relationships),
    unresolved_legal_references: parseUnresolved(row.unresolved_legal_references),
    allowed_actions: parseAllowedActions(row.allowed_actions),
  };
}

function parseUnresolved(raw: unknown): TaxKnowledgeUnresolvedLegalReference[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      from_tax_rule_version_id: asString(row.from_tax_rule_version_id),
      relationship_intent: asString(row.relationship_intent),
      relationship_intent_label: asString(row.relationship_intent_label) || asString(row.relationship_intent),
      activation_critical:
        row.activation_critical === true ? true : row.activation_critical === false ? false : null,
      activation_critical_label: asNullableString(row.activation_critical_label),
      cited_display: asString(row.cited_display) || asString(row.locator_text),
      locator_text: asString(row.locator_text),
      status: asString(row.status),
      status_label: asString(row.status_label) || asString(row.status),
      resolve_candidates: Array.isArray(row.resolve_candidates)
        ? row.resolve_candidates
            .map((item) => asRecord(item))
            .filter((item): item is UnknownRecord => item !== null)
            .map((item) => ({
              tax_rule_version_id: asString(item.tax_rule_version_id),
              tax_rule_id: asString(item.tax_rule_id),
              rule_code: asString(item.rule_code),
              title: asString(item.title),
              version_no: typeof item.version_no === 'number' ? item.version_no : Number(item.version_no) || 0,
              status: asString(item.status),
            }))
        : [],
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseVersions(raw: unknown): TaxKnowledgeVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map(parseVersion);
}

function parseCountryPacks(raw: unknown): OwnerCountryPackRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null && asString(row.id).trim() !== '')
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      pack_code: asString(row.pack_code),
      name: asString(row.name),
      status: asString(row.status),
    }));
}

function parseRulesets(raw: unknown): OwnerRulesetRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null && asString(row.id).trim() !== '')
    .map((row) => ({
      id: asString(row.id),
      country_pack_id: asString(row.country_pack_id),
      ruleset_code: asString(row.ruleset_code),
      ruleset_version: asString(row.ruleset_version),
      status: asString(row.status),
    }));
}

function parsePayloadJsonText(text: string): { ok: true; value: UnknownRecord } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'payload_json must be a JSON object.' };
    }
    return { ok: true, value: parsed as UnknownRecord };
  } catch {
    return { ok: false, error: 'payload_json is not valid JSON.' };
  }
}

function parseSources(raw: unknown): TaxKnowledgeSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      tax_domain_id: asNullableString(row.tax_domain_id),
      source_code: asString(row.source_code),
      title: asString(row.title),
      provenance_type: asString(row.provenance_type),
      issuer: asNullableString(row.issuer),
      citation_ref: asNullableString(row.citation_ref),
      source_url: asNullableString(row.source_url),
      published_on: asNullableString(row.published_on),
      status: asString(row.status),
      owner_note: asNullableString(row.owner_note),
      retired_at: asNullableString(row.retired_at),
      retired_reason: asNullableString(row.retired_reason),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseRules(raw: unknown): TaxKnowledgeRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      rule_code: asString(row.rule_code),
      title: asString(row.title),
      rule_kind: asString(row.rule_kind),
      status: asString(row.status),
      usage_hint: asNullableString(row.usage_hint),
      owner_note: asNullableString(row.owner_note),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      versions: parseVersions(row.versions),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseLabeledOptions(raw: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      value: asString(row.value),
      label: asString(row.label) || asString(row.value),
    }))
    .filter((row) => row.value);
}

function parseLibraryNodes(raw: unknown): OwnerLegalLibraryNode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      tax_source_id: asString(row.tax_source_id),
      parent_node_id: asNullableString(row.parent_node_id),
      tax_legal_node_kind_id: asString(row.tax_legal_node_kind_id),
      kind_label: asString(row.kind_label),
      node_code: asString(row.node_code),
      node_number: asNullableString(row.node_number),
      title: asString(row.title),
      display_title: asString(row.display_title) || asString(row.title),
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0,
      status: asString(row.status),
      owner_note: asNullableString(row.owner_note),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      linked_rules: Array.isArray(row.linked_rules)
        ? row.linked_rules
            .map((link) => asRecord(link))
            .filter((link): link is UnknownRecord => link !== null)
            .map((link) => ({
              link_id: asString(link.link_id),
              tax_rule_id: asString(link.tax_rule_id),
              tax_legal_node_id: asString(link.tax_legal_node_id),
              title: asString(link.title),
              rule_code: asString(link.rule_code),
              status: asString(link.status),
              version_count: typeof link.version_count === 'number' ? link.version_count : Number(link.version_count) || 0,
              allowed_actions: parseAllowedActions(link.allowed_actions),
            }))
        : [],
      children: parseLibraryNodes(row.children),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

function parseLibrarySources(raw: unknown): OwnerLegalLibrarySource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      id: asString(row.id),
      tax_domain_id: asNullableString(row.tax_domain_id),
      title: asString(row.title),
      provenance_type: asString(row.provenance_type),
      provenance_type_label: asString(row.provenance_type_label) || asString(row.provenance_type),
      status: asString(row.status),
      issuer: asNullableString(row.issuer),
      source_code: asString(row.source_code),
      nodes: parseLibraryNodes(row.nodes),
      allowed_actions: parseAllowedActions(row.allowed_actions),
    }));
}

export function parseLegalLibrary(raw: unknown): OwnerLegalLibrarySlice {
  const rec = asRecord(raw);
  if (!rec) return emptyLegalLibrarySlice();
  const trainer = asRecord(rec.trainer_upload);
  return {
    schema_applied: rec.schema_applied === true,
    domains: Array.isArray(rec.domains)
      ? rec.domains
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({
            id: asString(row.id),
            domain_code: asString(row.domain_code),
            title: asString(row.title),
            status: asString(row.status),
            owner_note: asNullableString(row.owner_note),
            sort_order: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0,
            sources: parseLibrarySources(row.sources),
            allowed_actions: parseAllowedActions(row.allowed_actions),
          }))
      : [],
    unassigned_sources: parseLibrarySources(rec.unassigned_sources),
    unassigned_rules: Array.isArray(rec.unassigned_rules)
      ? rec.unassigned_rules
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({
            id: asString(row.id),
            title: asString(row.title),
            rule_code: asString(row.rule_code),
            status: asString(row.status),
            version_count: typeof row.version_count === 'number' ? row.version_count : Number(row.version_count) || 0,
            allowed_actions: parseAllowedActions(row.allowed_actions),
          }))
      : [],
    node_kinds: Array.isArray(rec.node_kinds)
      ? rec.node_kinds
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({
            id: asString(row.id),
            country_code: asString(row.country_code),
            kind_code: asString(row.kind_code),
            label: asString(row.label),
            status: asString(row.status),
            owner_note: asNullableString(row.owner_note),
            sort_order: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0,
            created_at: asString(row.created_at),
            updated_at: asString(row.updated_at),
            allowed_actions: parseAllowedActions(row.allowed_actions),
          }))
      : [],
    provenance_type_options: parseLabeledOptions(rec.provenance_type_options),
    allowed_actions: parseAllowedActions(rec.allowed_actions),
    trainer_upload: parseKnowledgeTrainer(trainer),
  };
}

function parseKnowledgeTrainer(raw: UnknownRecord | null): OwnerKnowledgeTrainerSlice {
  const empty = emptyKnowledgeTrainerSlice();
  if (!raw) return empty;
  const selected = asRecord(raw.selected_document);
  return {
    available: raw.available === true,
    status_label: asString(raw.status_label) || empty.status_label,
    malware_scanning: asString(raw.malware_scanning) || 'not_implemented',
    input_options: Array.isArray(raw.input_options)
      ? raw.input_options
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({
            input_type: asString(row.input_type),
            available: row.available === true,
            label: asString(row.label) || asString(row.input_type),
            status_label: asString(row.status_label),
          }))
      : empty.input_options,
    documents: Array.isArray(raw.documents)
      ? raw.documents
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map(
            (row): OwnerKnowledgeTrainerDocument => ({
              id: asString(row.id),
              tax_source_id: asString(row.tax_source_id),
              original_filename: asString(row.original_filename),
              input_type: asString(row.input_type),
              provenance_type: asString(row.provenance_type),
              page_count: Number(row.page_count) || 0,
              extracted_page_count: Number(row.extracted_page_count) || 0,
              needs_ocr_page_count: Number(row.needs_ocr_page_count) || 0,
              failed_page_count: Number(row.failed_page_count) || 0,
              structure_candidate_count: Number(row.structure_candidate_count) || 0,
              job_status: asString(row.job_status),
              job_status_label: asString(row.job_status_label) || asString(row.job_status),
            }),
          )
      : [],
    selected_document: selected
      ? {
          id: asString(selected.id),
          original_filename: asString(selected.original_filename),
          job_status: asString(selected.job_status),
          job_status_label: asString(selected.job_status_label) || asString(selected.job_status),
          page_count: Number(selected.page_count) || 0,
          extracted_page_count: Number(selected.extracted_page_count) || 0,
          needs_ocr_page_count: Number(selected.needs_ocr_page_count) || 0,
          failed_page_count: Number(selected.failed_page_count) || 0,
          structure_candidate_count: Number(selected.structure_candidate_count) || 0,
          pages: Array.isArray(selected.pages)
            ? selected.pages
                .map((row) => asRecord(row))
                .filter((row): row is UnknownRecord => row !== null)
                .map((row) => ({
                  page_no: Number(row.page_no) || 0,
                  status: asString(row.status),
                  has_text: row.has_text === true,
                }))
            : [],
          selected_page: asRecord(selected.selected_page)
            ? {
                page_no: Number(asRecord(selected.selected_page)?.page_no) || 0,
                text:
                  typeof asRecord(selected.selected_page)?.text === 'string'
                    ? String(asRecord(selected.selected_page)?.text)
                    : null,
                status: asString(asRecord(selected.selected_page)?.status),
              }
            : null,
          candidates: Array.isArray(selected.candidates)
            ? selected.candidates
                .map((row) => asRecord(row))
                .filter((row): row is UnknownRecord => row !== null)
                .map(
                  (row): OwnerKnowledgeTrainerCandidate => ({
                    id: asString(row.id),
                    candidate_kind: asString(row.candidate_kind),
                    candidate_status: asString(row.candidate_status),
                    kind_label: asNullableString(row.kind_label),
                    node_number: asNullableString(row.node_number),
                    title: asNullableString(row.title),
                    parent_candidate_id: asNullableString(row.parent_candidate_id),
                    parent_tax_legal_node_id: asNullableString(row.parent_tax_legal_node_id),
                    page_start: row.page_start == null ? null : Number(row.page_start) || null,
                    page_end: row.page_end == null ? null : Number(row.page_end) || null,
                    excerpt: asNullableString(row.excerpt),
                    confidence: row.confidence == null ? null : Number(row.confidence),
                    validation_warnings: Array.isArray(row.validation_warnings)
                      ? row.validation_warnings.map((item) => String(item))
                      : [],
                    matched_tax_legal_node_id: asNullableString(row.matched_tax_legal_node_id),
                    accepted_tax_legal_node_id: asNullableString(row.accepted_tax_legal_node_id),
                    possible_existing_match: row.possible_existing_match === true,
                  }),
                )
            : [],
          can_open_original: selected.can_open_original === true,
        }
      : null,
    allowed_actions: parseAllowedActions(raw.allowed_actions),
  };
}

export function parseTaxKnowledgeAggregate(raw: unknown): TaxKnowledgeAggregate {
  const rec = asRecord(raw);
  if (!rec) return emptyTaxKnowledgeAggregate();

  const selectedRaw = rec.selected_country_code;
  const selected =
    typeof selectedRaw === 'string' && /^[A-Za-z]{2}$/.test(selectedRaw.trim())
      ? selectedRaw.trim().toUpperCase()
      : null;

  return {
    selected_country_code: selected,
    countries: parseCountries(rec.countries),
    sources: parseSources(rec.sources),
    rules: parseRules(rec.rules),
    rule_versions: parseVersions(rec.rule_versions),
    legal_library: parseLegalLibrary(rec.legal_library),
    allowed_actions: parseAllowedActions(rec.allowed_actions),
    implemented_commands: Array.isArray(rec.implemented_commands)
      ? rec.implemented_commands.filter((item): item is string => typeof item === 'string')
      : [],
    warnings: Array.isArray(rec.warnings)
      ? rec.warnings.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

const K2C_SOURCE_ACTION_KEYS = [
  'update_tax_source_metadata',
  'activate_tax_source',
  'retire_tax_source',
] as const;

const K2C_RULE_ACTION_KEYS = ['update_tax_rule_metadata'] as const;
const K2D_RULE_ACTION_KEYS = ['create_tax_rule_version'] as const;
const K2D_VERSION_ACTION_KEYS = ['update_tax_rule_version_draft'] as const;
const K2G_VERSION_ACTION_KEYS = [
  'activate_tax_rule_version',
  'retire_tax_rule_version',
  'close_tax_rule_version_effective_to',
  'supersede_tax_rule_version',
] as const;

function catalogAction(
  actions: TaxKnowledgeAllowedAction[],
  actionKey: string,
): TaxKnowledgeAllowedAction | null {
  return actions.find((action) => action.action_key === actionKey) ?? null;
}

function enabledAction(actions: TaxKnowledgeAllowedAction[], actionKey: string): TaxKnowledgeAllowedAction | null {
  const found = catalogAction(actions, actionKey);
  return found && found.enabled === true ? found : null;
}

function actionLabel(actionKey: string): string {
  return actionKey
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}

function omitBlank(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

type DialogKind =
  | 'create_tax_source'
  | 'create_tax_rule'
  | 'update_tax_source_metadata'
  | 'activate_tax_source'
  | 'retire_tax_source'
  | 'update_tax_rule_metadata'
  | 'create_tax_rule_version'
  | 'update_tax_rule_version_draft'
  | 'pin_tax_rule_version_source'
  | 'unpin_tax_rule_version_source'
  | 'bind_tax_rule_version_legal_value'
  | 'unbind_tax_rule_version_legal_value'
  | 'create_tax_rule_relationship'
  | 'delete_tax_rule_relationship'
  | 'activate_tax_rule_version'
  | 'retire_tax_rule_version'
  | 'close_tax_rule_version_effective_to'
  | 'supersede_tax_rule_version'
  | null;

export function OwnerTaxKnowledgePanel({
  taxKnowledge,
  countryPacks: countryPacksRaw,
  rulesets: rulesetsRaw,
  legalValues: legalValuesRaw,
  pendingCountryCode,
  busy,
  onSelectCountry,
  onCommand,
  showCountryPicker = true,
}: {
  taxKnowledge: TaxKnowledgeAggregate;
  countryPacks: unknown;
  rulesets: unknown;
  legalValues: unknown;
  pendingCountryCode: string | null;
  busy: boolean;
  onSelectCountry: (countryCode: string) => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
  showCountryPicker?: boolean;
}) {
  const selectedCountryCode = taxKnowledge.selected_country_code;
  const selectValue = pendingCountryCode ?? selectedCountryCode ?? '';
  const schemaNotApplied = asList(taxKnowledge.warnings).includes(SCHEMA_NOT_APPLIED);
  const countryPacks = parseCountryPacks(countryPacksRaw);
  const rulesets = parseRulesets(rulesetsRaw);
  const legalValueRows = parseLegalValuePickerRows(legalValuesRaw);
  const createSourceAction = catalogAction(taxKnowledge.allowed_actions, 'create_tax_source');
  const createRuleAction = catalogAction(taxKnowledge.allowed_actions, 'create_tax_rule');
  const createSourceAllowed = createSourceAction?.enabled === true;
  const createRuleAllowed = createRuleAction?.enabled === true;

  const [selectedSourceId, setSelectedSourceId] = useState(null as string | null);
  const [selectedRuleId, setSelectedRuleId] = useState(null as string | null);
  const [selectedVersionId, setSelectedVersionId] = useState(null as string | null);
  const [dialogKind, setDialogKind] = useState(null as DialogKind);
  const [formError, setFormError] = useState('');
  const [retireReason, setRetireReason] = useState('');
  const [sourceForm, setSourceForm] = useState({
    source_code: '',
    title: '',
    provenance_type: '',
    issuer: '',
    citation_ref: '',
    source_url: '',
    published_on: '',
    owner_note: '',
  });
  const [ruleForm, setRuleForm] = useState({
    rule_code: '',
    title: '',
    usage_hint: '',
    owner_note: '',
  });
  const [versionForm, setVersionForm] = useState({
    country_pack_id: '',
    country_pack_ruleset_id: '',
    effective_from: '',
    effective_to: '',
    payload_json: '{}',
  });
  const [pinForm, setPinForm] = useState({ tax_source_id: '', locator: '' });
  const [bindLegalValueId, setBindLegalValueId] = useState('');
  const [pendingCitationId, setPendingCitationId] = useState(null as string | null);
  const [pendingBindingId, setPendingBindingId] = useState(null as string | null);
  const [pendingRelationshipId, setPendingRelationshipId] = useState(null as string | null);
  const [relationshipForm, setRelationshipForm] = useState({
    to_tax_rule_version_id: '',
    relationship_type: TAX_KNOWLEDGE_RELATIONSHIP_TYPES[0] as string,
    activation_critical: '',
    owner_note: '',
  });
  const [closeEffectiveTo, setCloseEffectiveTo] = useState('');
  const [supersedeCandidateIndex, setSupersedeCandidateIndex] = useState(-1);

  const selectedSource = asList(taxKnowledge.sources).find((row) => row.id && row.id === selectedSourceId) ?? null;
  const selectedRule = asList(taxKnowledge.rules).find((row) => row.id && row.id === selectedRuleId) ?? null;
  const selectedVersion =
    asList(selectedRule?.versions).find((row) => row.id && row.id === selectedVersionId) ?? null;
  const packsForSelectedRule = selectedRule
    ? countryPacks.filter((row) => row.country_code === selectedRule.country_code)
    : [];
  const rulesetsForSelectedPack = rulesets.filter((row) => row.country_pack_id === versionForm.country_pack_id);
  const sourcesForSelectedVersion = selectedVersion
    ? asList(taxKnowledge.sources).filter((row) => row.country_code === selectedVersion.country_code)
    : [];
  const legalValuesForSelectedVersion = selectedVersion
    ? legalValueRows.filter((row) => row.country_code === selectedVersion.country_code)
    : [];
  const pendingCitation =
    asList(selectedVersion?.sources).find((row) => row.id && row.id === pendingCitationId) ?? null;
  const pendingBinding =
    asList(selectedVersion?.legal_value_bindings).find((row) => row.id && row.id === pendingBindingId) ?? null;
  const pendingRelationship =
    asList(selectedVersion?.relationships).find((row) => row.id && row.id === pendingRelationshipId) ?? null;
  const supersedeAction = enabledAction(
    selectedVersion?.allowed_actions ?? [],
    'supersede_tax_rule_version',
  );
  const supersedePairs = supersedePairsFromAction(supersedeAction);
  const targetVersionsForRelationship = selectedVersion
    ? asList(taxKnowledge.rules).flatMap((rule) =>
        asList(rule.versions)
          .filter(
            (version) =>
              Boolean(version.id) &&
              version.id !== selectedVersion.id &&
              version.country_code === selectedVersion.country_code,
          )
          .map((version) => ({ rule, version })),
      )
    : [];

  useEffect(() => {
    if (selectedSourceId && !asList(taxKnowledge.sources).some((row) => row.id === selectedSourceId)) {
      setSelectedSourceId(null);
    }
    if (selectedRuleId && !asList(taxKnowledge.rules).some((row) => row.id === selectedRuleId)) {
      setSelectedRuleId(null);
    }
  }, [taxKnowledge.sources, taxKnowledge.rules, selectedSourceId, selectedRuleId]);

  useEffect(() => {
    if (selectedVersionId && !asList(selectedRule?.versions).some((row) => row.id === selectedVersionId)) {
      setSelectedVersionId(null);
    }
  }, [selectedRule, selectedVersionId]);

  useEffect(() => {
    if (!dialogKind) return;
    setFormError('');
    setRetireReason('');
    if (dialogKind === 'pin_tax_rule_version_source') {
      setPinForm({ tax_source_id: '', locator: '' });
    }
    if (dialogKind === 'bind_tax_rule_version_legal_value') {
      setBindLegalValueId('');
    }
    if (dialogKind === 'create_tax_rule_relationship') {
      setRelationshipForm({
        to_tax_rule_version_id: '',
        relationship_type: TAX_KNOWLEDGE_RELATIONSHIP_TYPES[0] as string,
        activation_critical: '',
        owner_note: '',
      });
    }
    if (dialogKind === 'create_tax_source' || dialogKind === 'create_tax_rule') {
      setSourceForm({
        source_code: '',
        title: '',
        provenance_type: '',
        issuer: '',
        citation_ref: '',
        source_url: '',
        published_on: '',
        owner_note: '',
      });
      setRuleForm({ rule_code: '', title: '', usage_hint: '', owner_note: '' });
    }
    if (dialogKind === 'update_tax_source_metadata' && selectedSource) {
      setSourceForm({
        source_code: selectedSource.source_code,
        title: selectedSource.title,
        provenance_type: selectedSource.provenance_type,
        issuer: selectedSource.issuer ?? '',
        citation_ref: selectedSource.citation_ref ?? '',
        source_url: selectedSource.source_url ?? '',
        published_on: (selectedSource.published_on ?? '').slice(0, 10),
        owner_note: selectedSource.owner_note ?? '',
      });
    }
    if (dialogKind === 'update_tax_rule_metadata' && selectedRule) {
      setRuleForm({
        rule_code: selectedRule.rule_code,
        title: selectedRule.title,
        usage_hint: selectedRule.usage_hint ?? '',
        owner_note: selectedRule.owner_note ?? '',
      });
    }
    if (dialogKind === 'create_tax_rule_version') {
      setVersionForm({
        country_pack_id: '',
        country_pack_ruleset_id: '',
        effective_from: '',
        effective_to: '',
        payload_json: '{}',
      });
    }
    if (dialogKind === 'update_tax_rule_version_draft' && selectedVersion) {
      setVersionForm({
        country_pack_id: selectedVersion.country_pack_id,
        country_pack_ruleset_id: selectedVersion.country_pack_ruleset_id,
        effective_from: (selectedVersion.effective_from ?? '').slice(0, 10),
        effective_to: (selectedVersion.effective_to ?? '').slice(0, 10),
        payload_json: JSON.stringify(selectedVersion.payload_json ?? {}, null, 2),
      });
    }
    if (dialogKind === 'close_tax_rule_version_effective_to' && selectedVersion) {
      setCloseEffectiveTo((selectedVersion.effective_to ?? '').slice(0, 10));
    }
    if (dialogKind === 'supersede_tax_rule_version') {
      const action = enabledAction(selectedVersion?.allowed_actions ?? [], 'supersede_tax_rule_version');
      const pairs = supersedePairsFromAction(action);
      setSupersedeCandidateIndex(pairs.length === 1 ? 0 : -1);
    }
  }, [dialogKind, selectedSource, selectedRule, selectedVersion]);

  async function submitDialog(): Promise<void> {
    setFormError('');
    try {
      if (dialogKind === 'create_tax_source') {
        if (!createSourceAllowed) return;
        if (!selectedCountryCode) {
          setFormError('Select a country first.');
          return;
        }
        const required = omitBlank({
          country_code: selectedCountryCode,
          source_code: sourceForm.source_code,
          title: sourceForm.title,
          provenance_type: sourceForm.provenance_type,
        });
        if (!required.source_code || !required.title || !required.provenance_type) {
          setFormError('source_code, title, and provenance_type are required.');
          return;
        }
        await onCommand('create_tax_source', {
          ...required,
          ...omitBlank({
            issuer: sourceForm.issuer,
            citation_ref: sourceForm.citation_ref,
            source_url: sourceForm.source_url,
            published_on: sourceForm.published_on,
            owner_note: sourceForm.owner_note,
          }),
        });
      } else if (dialogKind === 'create_tax_rule') {
        if (!createRuleAllowed) return;
        if (!selectedCountryCode) {
          setFormError('Select a country first.');
          return;
        }
        const required = omitBlank({
          country_code: selectedCountryCode,
          rule_code: ruleForm.rule_code,
          title: ruleForm.title,
        });
        if (!required.rule_code || !required.title) {
          setFormError('rule_code and title are required.');
          return;
        }
        await onCommand('create_tax_rule', {
          ...required,
          ...omitBlank({
            usage_hint: ruleForm.usage_hint,
            owner_note: ruleForm.owner_note,
          }),
        });
      } else if (dialogKind === 'update_tax_source_metadata') {
        if (!enabledAction(selectedSource?.allowed_actions ?? [], 'update_tax_source_metadata') || !selectedSource) {
          return;
        }
        if (!sourceForm.title.trim()) {
          setFormError('title is required.');
          return;
        }
        await onCommand('update_tax_source_metadata', {
          tax_source_id: selectedSource.id,
          title: sourceForm.title.trim(),
          issuer: sourceForm.issuer.trim(),
          citation_ref: sourceForm.citation_ref.trim(),
          source_url: sourceForm.source_url.trim(),
          published_on: sourceForm.published_on.trim(),
          owner_note: sourceForm.owner_note.trim(),
          ...omitBlank({ provenance_type: sourceForm.provenance_type }),
        });
      } else if (dialogKind === 'activate_tax_source') {
        if (!enabledAction(selectedSource?.allowed_actions ?? [], 'activate_tax_source') || !selectedSource) {
          return;
        }
        await onCommand('activate_tax_source', { tax_source_id: selectedSource.id });
      } else if (dialogKind === 'retire_tax_source') {
        if (!enabledAction(selectedSource?.allowed_actions ?? [], 'retire_tax_source') || !selectedSource) {
          return;
        }
        const payload: UnknownRecord = { tax_source_id: selectedSource.id };
        const reason = retireReason.trim();
        if (reason) payload.reason = reason;
        await onCommand('retire_tax_source', payload);
      } else if (dialogKind === 'update_tax_rule_metadata') {
        if (!enabledAction(selectedRule?.allowed_actions ?? [], 'update_tax_rule_metadata') || !selectedRule) {
          return;
        }
        if (!ruleForm.title.trim()) {
          setFormError('title is required.');
          return;
        }
        await onCommand('update_tax_rule_metadata', {
          tax_rule_id: selectedRule.id,
          title: ruleForm.title.trim(),
          usage_hint: ruleForm.usage_hint.trim(),
          owner_note: ruleForm.owner_note.trim(),
        });
      } else if (dialogKind === 'create_tax_rule_version') {
        if (!enabledAction(selectedRule?.allowed_actions ?? [], 'create_tax_rule_version') || !selectedRule) {
          return;
        }
        if (!versionForm.country_pack_id || !versionForm.country_pack_ruleset_id || !versionForm.effective_from.trim()) {
          setFormError('country_pack_id, country_pack_ruleset_id, and effective_from are required.');
          return;
        }
        const parsedPayload = parsePayloadJsonText(versionForm.payload_json);
        if (!parsedPayload.ok) {
          setFormError(parsedPayload.error);
          return;
        }
        const createPayload: UnknownRecord = {
          tax_rule_id: selectedRule.id,
          country_pack_id: versionForm.country_pack_id,
          country_pack_ruleset_id: versionForm.country_pack_ruleset_id,
          effective_from: versionForm.effective_from.trim(),
          payload_json: parsedPayload.value,
        };
        if (versionForm.effective_to.trim()) createPayload.effective_to = versionForm.effective_to.trim();
        await onCommand('create_tax_rule_version', createPayload);
      } else if (dialogKind === 'update_tax_rule_version_draft') {
        if (
          !enabledAction(selectedVersion?.allowed_actions ?? [], 'update_tax_rule_version_draft') ||
          !selectedVersion
        ) {
          return;
        }
        if (!versionForm.country_pack_id || !versionForm.country_pack_ruleset_id || !versionForm.effective_from.trim()) {
          setFormError('country_pack_id, country_pack_ruleset_id, and effective_from are required.');
          return;
        }
        const parsedPayload = parsePayloadJsonText(versionForm.payload_json);
        if (!parsedPayload.ok) {
          setFormError(parsedPayload.error);
          return;
        }
        await onCommand('update_tax_rule_version_draft', {
          tax_rule_version_id: selectedVersion.id,
          country_pack_id: versionForm.country_pack_id,
          country_pack_ruleset_id: versionForm.country_pack_ruleset_id,
          effective_from: versionForm.effective_from.trim(),
          effective_to: versionForm.effective_to.trim(),
          payload_json: parsedPayload.value,
        });
      } else if (dialogKind === 'pin_tax_rule_version_source') {
        if (!enabledAction(selectedVersion?.allowed_actions ?? [], 'pin_tax_rule_version_source') || !selectedVersion) {
          return;
        }
        if (!pinForm.tax_source_id) {
          setFormError('tax_source_id is required.');
          return;
        }
        const pinPayload: UnknownRecord = {
          tax_rule_version_id: selectedVersion.id,
          tax_source_id: pinForm.tax_source_id,
        };
        if (pinForm.locator.trim()) pinPayload.locator = pinForm.locator.trim();
        await onCommand('pin_tax_rule_version_source', pinPayload);
      } else if (dialogKind === 'unpin_tax_rule_version_source') {
        if (!pendingCitation || !enabledAction(pendingCitation.allowed_actions, 'unpin_tax_rule_version_source')) {
          return;
        }
        await onCommand('unpin_tax_rule_version_source', {
          tax_rule_version_source_id: pendingCitation.id,
        });
      } else if (dialogKind === 'bind_tax_rule_version_legal_value') {
        if (
          !enabledAction(selectedVersion?.allowed_actions ?? [], 'bind_tax_rule_version_legal_value') ||
          !selectedVersion
        ) {
          return;
        }
        if (!bindLegalValueId) {
          setFormError('legal_value_id is required.');
          return;
        }
        await onCommand('bind_tax_rule_version_legal_value', {
          tax_rule_version_id: selectedVersion.id,
          legal_value_id: bindLegalValueId,
        });
      } else if (dialogKind === 'unbind_tax_rule_version_legal_value') {
        if (!pendingBinding || !enabledAction(pendingBinding.allowed_actions, 'unbind_tax_rule_version_legal_value')) {
          return;
        }
        await onCommand('unbind_tax_rule_version_legal_value', {
          tax_rule_version_legal_value_id: pendingBinding.id,
        });
      } else if (dialogKind === 'create_tax_rule_relationship') {
        if (
          !enabledAction(selectedVersion?.allowed_actions ?? [], 'create_tax_rule_relationship') ||
          !selectedVersion
        ) {
          return;
        }
        if (!relationshipForm.to_tax_rule_version_id || !relationshipForm.relationship_type) {
          setFormError('to_tax_rule_version_id and relationship_type are required.');
          return;
        }
        const createRel: UnknownRecord = {
          from_tax_rule_version_id: selectedVersion.id,
          to_tax_rule_version_id: relationshipForm.to_tax_rule_version_id,
          relationship_type: relationshipForm.relationship_type,
        };
        if (relationshipForm.owner_note.trim()) createRel.owner_note = relationshipForm.owner_note.trim();
        if (relationshipForm.relationship_type === 'procedural_requirement') {
          if (relationshipForm.activation_critical !== 'true' && relationshipForm.activation_critical !== 'false') {
            setFormError('activation_critical is required for a procedural requirement.');
            return;
          }
          createRel.activation_critical = relationshipForm.activation_critical === 'true';
        }
        await onCommand('create_tax_rule_relationship', createRel);
      } else if (dialogKind === 'delete_tax_rule_relationship') {
        if (
          !pendingRelationship ||
          !enabledAction(pendingRelationship.allowed_actions, 'delete_tax_rule_relationship')
        ) {
          return;
        }
        await onCommand('delete_tax_rule_relationship', {
          tax_rule_relationship_id: pendingRelationship.id,
        });
      } else if (dialogKind === 'activate_tax_rule_version') {
        if (!enabledAction(selectedVersion?.allowed_actions ?? [], 'activate_tax_rule_version') || !selectedVersion) {
          return;
        }
        await onCommand('activate_tax_rule_version', { tax_rule_version_id: selectedVersion.id });
      } else if (dialogKind === 'retire_tax_rule_version') {
        if (!enabledAction(selectedVersion?.allowed_actions ?? [], 'retire_tax_rule_version') || !selectedVersion) {
          return;
        }
        const retirePayload: UnknownRecord = { tax_rule_version_id: selectedVersion.id };
        const reason = retireReason.trim();
        if (reason) retirePayload.reason = reason;
        await onCommand('retire_tax_rule_version', retirePayload);
      } else if (dialogKind === 'close_tax_rule_version_effective_to') {
        if (
          !enabledAction(selectedVersion?.allowed_actions ?? [], 'close_tax_rule_version_effective_to') ||
          !selectedVersion
        ) {
          return;
        }
        const effectiveTo = closeEffectiveTo.trim();
        if (!effectiveTo) {
          setFormError('effective_to is required.');
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
          setFormError('effective_to must be YYYY-MM-DD.');
          return;
        }
        await onCommand('close_tax_rule_version_effective_to', {
          tax_rule_version_id: selectedVersion.id,
          effective_to: effectiveTo,
        });
      } else if (dialogKind === 'supersede_tax_rule_version') {
        if (
          !enabledAction(selectedVersion?.allowed_actions ?? [], 'supersede_tax_rule_version') ||
          !selectedVersion
        ) {
          return;
        }
        const pairs = supersedePairsFromAction(
          enabledAction(selectedVersion.allowed_actions, 'supersede_tax_rule_version'),
        );
        const pair = pairs.length === 1 ? pairs[0] : pairs[supersedeCandidateIndex];
        if (!pair) {
          setFormError('Select a supersession pair.');
          return;
        }
        await onCommand('supersede_tax_rule_version', {
          new_tax_rule_version_id: pair.new_tax_rule_version_id,
          old_tax_rule_version_id: pair.old_tax_rule_version_id,
        });
      } else {
        return;
      }
      setDialogKind(null);
      setPendingCitationId(null);
      setPendingBindingId(null);
      setPendingRelationshipId(null);
    } catch (e) {
      setFormError(userFacingApiMessage(e));
    }
  }

  return (
    <SectionCard
      style={{
        marginTop: 18,
        padding: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Tax Knowledge</h2>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13 }}>
            Canonical legal sources and rules. Country-scoped. Commands only.
          </p>
        </div>
        {showCountryPicker ? (
        <label className="nx-field" style={{ minWidth: 220 }}>
          <span className="nx-field-label">Country</span>
          <select
            className="nx-select"
            value={selectValue}
            disabled={busy}
            onChange={(e) => onSelectCountry(e.target.value)}
          >
            <option value="">Select country</option>
            {asList(taxKnowledge.countries).map((country) => (
              <option key={country.code} value={country.code}>
                {country.code} — {country.name}
              </option>
            ))}
          </select>
        </label>
        ) : null}
      </div>

      {selectedCountryCode ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#374151' }}>
          Selected country: <strong>{selectedCountryCode}</strong>
        </p>
      ) : null}

      {asList(taxKnowledge.warnings).length ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 6,
            background: '#fff8e6',
            border: '1px solid #f0d090',
            color: '#92400e',
          }}
        >
          <strong>Tax Knowledge warnings</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {asList(taxKnowledge.warnings).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || !createSourceAllowed}
          onClick={() => setDialogKind('create_tax_source')}
        >
          Create tax source
        </button>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || !createRuleAllowed}
          onClick={() => setDialogKind('create_tax_rule')}
        >
          Create tax rule
        </button>
      </div>

      {!selectedCountryCode ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="No country selected"
            description="Select a country to load Tax Knowledge sources and rules from the owner legal-control aggregate."
          />
        </div>
      ) : null}

      {selectedCountryCode && schemaNotApplied ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title="Tax Knowledge schema is not applied" description={SCHEMA_NOT_APPLIED} />
        </div>
      ) : null}

      {selectedCountryCode && !schemaNotApplied ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Sources</h3>
            {asList(taxKnowledge.sources).length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>source_code</th>
                      <th style={TH_STYLE}>title</th>
                      <th style={TH_STYLE}>provenance_type</th>
                      <th style={TH_STYLE}>status</th>
                      <th style={TH_STYLE}>issuer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asList(taxKnowledge.sources).map((row) => {
                      const isSelected = Boolean(row.id) && row.id === selectedSourceId;
                      return (
                        <tr
                          key={row.id || row.source_code}
                          onClick={() => row.id && setSelectedSourceId(row.id)}
                          style={{ cursor: row.id ? 'pointer' : 'default', background: isSelected ? '#eff6ff' : undefined }}
                        >
                          <td style={TD_STYLE}>{row.source_code}</td>
                          <td style={TD_STYLE}>{row.title}</td>
                          <td style={TD_STYLE}>{row.provenance_type}</td>
                          <td style={TD_STYLE}>{row.status}</td>
                          <td style={TD_STYLE}>{row.issuer ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No sources" description="No tax sources for this country." />
            )}
            {selectedSource ? (
              <div style={{ marginTop: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Source</div>
                <StateRow label="source_code" value={selectedSource.source_code} />
                <StateRow label="title" value={selectedSource.title} />
                <StateRow label="provenance_type" value={selectedSource.provenance_type} />
                <StateRow label="issuer" value={selectedSource.issuer ?? ''} />
                <StateRow label="citation_ref" value={selectedSource.citation_ref ?? ''} />
                <StateRow label="source_url" value={selectedSource.source_url ?? ''} />
                <StateRow label="published_on" value={selectedSource.published_on ?? ''} />
                <StateRow label="status" value={selectedSource.status} />
                <StateRow label="owner_note" value={selectedSource.owner_note ?? ''} />
                <StateRow label="retired_at" value={selectedSource.retired_at ?? ''} />
                <StateRow label="retired_reason" value={selectedSource.retired_reason ?? ''} />
                <StateRow label="created_at" value={selectedSource.created_at} />
                <StateRow label="updated_at" value={selectedSource.updated_at} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {K2C_SOURCE_ACTION_KEYS.map((actionKey) => {
                    const action = enabledAction(selectedSource.allowed_actions, actionKey);
                    if (!action) return null;
                    return (
                      <button
                        key={actionKey}
                        type="button"
                        className="nx-btn nx-btn-taxes-compact"
                        disabled={busy}
                        onClick={() => setDialogKind(actionKey)}
                      >
                        {actionLabel(actionKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : asList(taxKnowledge.sources).length ? (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>Select a source to view details and actions.</p>
            ) : null}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Rules</h3>
            {asList(taxKnowledge.rules).length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={TH_STYLE}>rule_code</th>
                      <th style={TH_STYLE}>title</th>
                      <th style={TH_STYLE}>rule_kind</th>
                      <th style={TH_STYLE}>status</th>
                      <th style={TH_STYLE}>versions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asList(taxKnowledge.rules).map((row) => {
                      const isSelected = Boolean(row.id) && row.id === selectedRuleId;
                      return (
                        <tr
                          key={row.id || row.rule_code}
                          onClick={() => row.id && setSelectedRuleId(row.id)}
                          style={{ cursor: row.id ? 'pointer' : 'default', background: isSelected ? '#eff6ff' : undefined }}
                        >
                          <td style={TD_STYLE}>{row.rule_code}</td>
                          <td style={TD_STYLE}>{row.title}</td>
                          <td style={TD_STYLE}>{row.rule_kind}</td>
                          <td style={TD_STYLE}>{row.status}</td>
                          <td style={TD_STYLE}>{row.versions?.length ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No rules" description="No tax rules for this country." />
            )}
            {selectedRule ? (
              <div style={{ marginTop: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#f9fafb' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Rule</div>
                <StateRow label="rule_code" value={selectedRule.rule_code} />
                <StateRow label="title" value={selectedRule.title} />
                <StateRow label="rule_kind" value={selectedRule.rule_kind} />
                <StateRow label="status" value={selectedRule.status} />
                <StateRow label="usage_hint" value={selectedRule.usage_hint ?? ''} />
                <StateRow label="owner_note" value={selectedRule.owner_note ?? ''} />
                <StateRow label="created_at" value={selectedRule.created_at} />
                <StateRow label="updated_at" value={selectedRule.updated_at} />
                <StateRow label="versions" value={String(selectedRule.versions?.length ?? 0)} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {[...K2C_RULE_ACTION_KEYS, ...K2D_RULE_ACTION_KEYS].map((actionKey) => {
                    const action = enabledAction(selectedRule.allowed_actions, actionKey);
                    if (!action) return null;
                    return (
                      <button
                        key={actionKey}
                        type="button"
                        className="nx-btn nx-btn-taxes-compact"
                        disabled={busy}
                        onClick={() => setDialogKind(actionKey)}
                      >
                        {actionLabel(actionKey)}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Versions</div>
                  {asList(selectedRule.versions).length ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={TABLE_STYLE}>
                        <thead>
                          <tr>
                            <th style={TH_STYLE}>version_no</th>
                            <th style={TH_STYLE}>status</th>
                            <th style={TH_STYLE}>effective_from</th>
                            <th style={TH_STYLE}>effective_to</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(Array.isArray(selectedRule.versions) ? selectedRule.versions : []).map((row) => {
                            const isSelected = Boolean(row.id) && row.id === selectedVersionId;
                            return (
                              <tr
                                key={row.id || String(row.version_no)}
                                onClick={() => row.id && setSelectedVersionId(row.id)}
                                style={{
                                  cursor: row.id ? 'pointer' : 'default',
                                  background: isSelected ? '#eff6ff' : undefined,
                                }}
                              >
                                <td style={TD_STYLE}>{String(row.version_no)}</td>
                                <td style={TD_STYLE}>{row.status}</td>
                                <td style={TD_STYLE}>{row.effective_from}</td>
                                <td style={TD_STYLE}>{row.effective_to ?? ''}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No versions for this rule.</p>
                  )}
                  {selectedVersion ? (
                    <div style={{ marginTop: 10, padding: 10, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Version</div>
                      <StateRow label="version_no" value={String(selectedVersion.version_no)} />
                      <StateRow label="status" value={selectedVersion.status} />
                      <StateRow label="effective_from" value={selectedVersion.effective_from} />
                      <StateRow label="effective_to" value={selectedVersion.effective_to ?? ''} />
                      <StateRow label="country_pack_id" value={selectedVersion.country_pack_id} />
                      <StateRow label="country_pack_ruleset_id" value={selectedVersion.country_pack_ruleset_id} />
                      <StateRow label="payload_checksum" value={selectedVersion.payload_checksum} />
                      <StateRow label="supersedes_version_id" value={selectedVersion.supersedes_version_id ?? ''} />
                      {selectedVersion.superseded_by_version_id ? (
                        <StateRow
                          label="superseded_by"
                          value={versionPresentationLabel(
                            selectedVersion.superseded_by_version_id,
                            taxKnowledge.rules,
                          )}
                        />
                      ) : null}
                      {selectedVersion.retired_at ? (
                        <StateRow label="retired_at" value={selectedVersion.retired_at} />
                      ) : null}
                      {selectedVersion.retired_reason ? (
                        <StateRow label="retired_reason" value={selectedVersion.retired_reason} />
                      ) : null}
                      <StateRow label="created_at" value={selectedVersion.created_at} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {K2D_VERSION_ACTION_KEYS.map((actionKey) => {
                          const action = enabledAction(selectedVersion.allowed_actions, actionKey);
                          if (!action) return null;
                          return (
                            <button
                              key={actionKey}
                              type="button"
                              className="nx-btn nx-btn-taxes-compact"
                              disabled={busy}
                              onClick={() => setDialogKind(actionKey)}
                            >
                              {actionLabel(actionKey)}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Provenance</div>
                        {asList(selectedVersion.sources).length ? (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={TABLE_STYLE}>
                              <thead>
                                <tr>
                                  <th style={TH_STYLE}>source_code</th>
                                  <th style={TH_STYLE}>title</th>
                                  <th style={TH_STYLE}>provenance_type</th>
                                  <th style={TH_STYLE}>status</th>
                                  <th style={TH_STYLE}>locator</th>
                                  <th style={TH_STYLE}>created_at</th>
                                  <th style={TH_STYLE}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {asList(selectedVersion.sources).map((citation) => {
                                  const unpin = enabledAction(citation.allowed_actions, 'unpin_tax_rule_version_source');
                                  return (
                                    <tr key={citation.id || `${citation.tax_source_id}-${citation.locator ?? ''}`}>
                                      <td style={TD_STYLE}>{citation.source_code}</td>
                                      <td style={TD_STYLE}>{citation.title}</td>
                                      <td style={TD_STYLE}>{citation.provenance_type}</td>
                                      <td style={TD_STYLE}>{citation.status}</td>
                                      <td style={TD_STYLE}>{citation.locator ?? ''}</td>
                                      <td style={TD_STYLE}>{citation.created_at}</td>
                                      <td style={TD_STYLE}>
                                        {unpin ? (
                                          <button
                                            type="button"
                                            className="nx-btn nx-btn-taxes-compact"
                                            disabled={busy}
                                            onClick={() => {
                                              setPendingCitationId(citation.id);
                                              setDialogKind('unpin_tax_rule_version_source');
                                            }}
                                          >
                                            {actionLabel('unpin_tax_rule_version_source')}
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No pinned sources.</p>
                        )}
                        {enabledAction(selectedVersion.allowed_actions, 'pin_tax_rule_version_source') ? (
                          <button
                            type="button"
                            className="nx-btn nx-btn-taxes-compact"
                            disabled={busy}
                            style={{ marginTop: 8 }}
                            onClick={() => setDialogKind('pin_tax_rule_version_source')}
                          >
                            {actionLabel('pin_tax_rule_version_source')}
                          </button>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Legal value bindings</div>
                        {asList(selectedVersion.legal_value_bindings).length ? (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={TABLE_STYLE}>
                              <thead>
                                <tr>
                                  <th style={TH_STYLE}>value_key</th>
                                  <th style={TH_STYLE}>label</th>
                                  <th style={TH_STYLE}>category</th>
                                  <th style={TH_STYLE}>module_scope</th>
                                  <th style={TH_STYLE}>status</th>
                                  <th style={TH_STYLE}>created_at</th>
                                  <th style={TH_STYLE}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {asList(selectedVersion.legal_value_bindings).map((binding) => {
                                  const unbind = enabledAction(
                                    binding.allowed_actions,
                                    'unbind_tax_rule_version_legal_value',
                                  );
                                  return (
                                    <tr key={binding.id || binding.legal_value_id}>
                                      <td style={TD_STYLE}>{binding.value_key}</td>
                                      <td style={TD_STYLE}>{binding.label}</td>
                                      <td style={TD_STYLE}>{binding.category ?? ''}</td>
                                      <td style={TD_STYLE}>{binding.module_scope ?? ''}</td>
                                      <td style={TD_STYLE}>{binding.status}</td>
                                      <td style={TD_STYLE}>{binding.created_at}</td>
                                      <td style={TD_STYLE}>
                                        {unbind ? (
                                          <button
                                            type="button"
                                            className="nx-btn nx-btn-taxes-compact"
                                            disabled={busy}
                                            onClick={() => {
                                              setPendingBindingId(binding.id);
                                              setDialogKind('unbind_tax_rule_version_legal_value');
                                            }}
                                          >
                                            {actionLabel('unbind_tax_rule_version_legal_value')}
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No legal value bindings.</p>
                        )}
                        {enabledAction(selectedVersion.allowed_actions, 'bind_tax_rule_version_legal_value') ? (
                          <button
                            type="button"
                            className="nx-btn nx-btn-taxes-compact"
                            disabled={busy}
                            style={{ marginTop: 8 }}
                            onClick={() => setDialogKind('bind_tax_rule_version_legal_value')}
                          >
                            {actionLabel('bind_tax_rule_version_legal_value')}
                          </button>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Relationships</div>
                        {asList(selectedVersion.relationships).length ? (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={TABLE_STYLE}>
                              <thead>
                                <tr>
                                  <th style={TH_STYLE}>relationship_type</th>
                                  <th style={TH_STYLE}>to_rule_code</th>
                                  <th style={TH_STYLE}>to_title</th>
                                  <th style={TH_STYLE}>to_version_no</th>
                                  <th style={TH_STYLE}>to_status</th>
                                  <th style={TH_STYLE}>owner_note</th>
                                  <th style={TH_STYLE}>created_at</th>
                                  <th style={TH_STYLE}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {asList(selectedVersion.relationships).map((rel) => {
                                  const del = enabledAction(rel.allowed_actions, 'delete_tax_rule_relationship');
                                  return (
                                    <tr key={rel.id || `${rel.to_tax_rule_version_id}-${rel.relationship_type}`}>
                                      <td style={TD_STYLE}>{rel.relationship_type}</td>
                                      <td style={TD_STYLE}>{rel.to_rule_code}</td>
                                      <td style={TD_STYLE}>{rel.to_title}</td>
                                      <td style={TD_STYLE}>{String(rel.to_version_no)}</td>
                                      <td style={TD_STYLE}>{rel.to_status}</td>
                                      <td style={TD_STYLE}>{rel.owner_note ?? ''}</td>
                                      <td style={TD_STYLE}>{rel.created_at}</td>
                                      <td style={TD_STYLE}>
                                        {del ? (
                                          <button
                                            type="button"
                                            className="nx-btn nx-btn-taxes-compact"
                                            disabled={busy}
                                            onClick={() => {
                                              setPendingRelationshipId(rel.id);
                                              setDialogKind('delete_tax_rule_relationship');
                                            }}
                                          >
                                            {actionLabel('delete_tax_rule_relationship')}
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No outgoing relationships.</p>
                        )}
                        {enabledAction(selectedVersion.allowed_actions, 'create_tax_rule_relationship') ? (
                          <button
                            type="button"
                            className="nx-btn nx-btn-taxes-compact"
                            disabled={busy}
                            style={{ marginTop: 8 }}
                            onClick={() => setDialogKind('create_tax_rule_relationship')}
                          >
                            {actionLabel('create_tax_rule_relationship')}
                          </button>
                        ) : null}
                        <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 8px' }}>
                          Unresolved legal references
                        </div>
                        {asList(selectedVersion.unresolved_legal_references).length ? (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={TABLE_STYLE}>
                              <thead>
                                <tr>
                                  <th style={TH_STYLE}>Meaning</th>
                                  <th style={TH_STYLE}>Citation</th>
                                  <th style={TH_STYLE}>Status</th>
                                  <th style={TH_STYLE}>Criticality</th>
                                </tr>
                              </thead>
                              <tbody>
                                {asList(selectedVersion.unresolved_legal_references).map((row) => (
                                  <tr key={row.id}>
                                    <td style={TD_STYLE}>{row.relationship_intent_label}</td>
                                    <td style={TD_STYLE}>{row.cited_display}</td>
                                    <td style={TD_STYLE}>{row.status_label}</td>
                                    <td style={TD_STYLE}>{row.activation_critical_label || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No unresolved legal references.</p>
                        )}
                      </div>
                      {K2G_VERSION_ACTION_KEYS.some((actionKey) =>
                        enabledAction(selectedVersion.allowed_actions, actionKey),
                      ) ? (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Lifecycle</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {K2G_VERSION_ACTION_KEYS.map((actionKey) => {
                              const action = enabledAction(selectedVersion.allowed_actions, actionKey);
                              if (!action) return null;
                              return (
                                <button
                                  key={actionKey}
                                  type="button"
                                  className="nx-btn nx-btn-taxes-compact"
                                  disabled={busy}
                                  onClick={() => setDialogKind(actionKey)}
                                >
                                  {actionLabel(actionKey)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : asList(selectedRule.versions).length ? (
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>
                      Select a version to view details and actions.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : asList(taxKnowledge.rules).length ? (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>Select a rule to view details and actions.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {dialogKind ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setDialogKind(null);
          }}
        >
          <div
            className="nx-modal nx-accounting-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label={actionLabel(dialogKind)}
            style={{
              direction: 'ltr',
              maxWidth:
                dialogKind === 'create_tax_rule_version' || dialogKind === 'update_tax_rule_version_draft' ? 640 : 560,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked" style={{ alignItems: 'flex-start' }}>
                <h2 className="nx-modal-title" style={{ fontSize: 18 }}>
                  {actionLabel(dialogKind)}
                </h2>
                <span className="nx-modal-subtitle">
                  {dialogKind}
                  {dialogKind === 'create_tax_rule_version' && selectedRule
                    ? ` · ${selectedRule.rule_code}`
                    : dialogKind === 'update_tax_rule_version_draft' && selectedVersion
                      ? ` · version_no ${selectedVersion.version_no}`
                      : dialogKind === 'pin_tax_rule_version_source' && selectedVersion
                        ? ` · version_no ${selectedVersion.version_no}`
                        : dialogKind === 'unpin_tax_rule_version_source' && pendingCitation
                          ? ` · ${pendingCitation.source_code}`
                          : dialogKind === 'bind_tax_rule_version_legal_value' && selectedVersion
                            ? ` · version_no ${selectedVersion.version_no}`
                            : dialogKind === 'unbind_tax_rule_version_legal_value' && pendingBinding
                              ? ` · ${pendingBinding.value_key}`
                              : dialogKind === 'create_tax_rule_relationship' && selectedVersion
                                ? ` · version_no ${selectedVersion.version_no}`
                                : dialogKind === 'delete_tax_rule_relationship' && pendingRelationship
                                  ? ` · ${pendingRelationship.relationship_type}`
                              : (dialogKind === 'activate_tax_rule_version' ||
                                    dialogKind === 'retire_tax_rule_version' ||
                                    dialogKind === 'close_tax_rule_version_effective_to' ||
                                    dialogKind === 'supersede_tax_rule_version') &&
                                  selectedVersion
                                ? ` · version_no ${selectedVersion.version_no}`
                      : dialogKind.startsWith('create_')
                        ? ` · country ${selectedCountryCode || '—'}`
                        : selectedSource && dialogKind.includes('source')
                          ? ` · ${selectedSource.source_code}`
                          : selectedRule && dialogKind.includes('rule')
                            ? ` · ${selectedRule.rule_code}`
                            : ''}
                </span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setDialogKind(null)}
                disabled={busy}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="nx-modal-body" style={{ flex: '0 1 auto' }}>
              {formError ? <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 0 }}>{formError}</p> : null}
              {dialogKind === 'create_tax_source' || dialogKind === 'update_tax_source_metadata' ? (
                <div className="nx-form-grid">
                  {dialogKind === 'create_tax_source' ? (
                    <label className="nx-field">
                      <span className="nx-field-label">source_code</span>
                      <input
                        className="nx-input"
                        value={sourceForm.source_code}
                        onChange={(e) => setSourceForm((s) => ({ ...s, source_code: e.target.value }))}
                      />
                    </label>
                  ) : null}
                  <label className="nx-field">
                    <span className="nx-field-label">title</span>
                    <input
                      className="nx-input"
                      value={sourceForm.title}
                      onChange={(e) => setSourceForm((s) => ({ ...s, title: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">provenance_type</span>
                    <input
                      className="nx-input"
                      value={sourceForm.provenance_type}
                      onChange={(e) => setSourceForm((s) => ({ ...s, provenance_type: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">issuer</span>
                    <input
                      className="nx-input"
                      value={sourceForm.issuer}
                      onChange={(e) => setSourceForm((s) => ({ ...s, issuer: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">citation_ref</span>
                    <input
                      className="nx-input"
                      value={sourceForm.citation_ref}
                      onChange={(e) => setSourceForm((s) => ({ ...s, citation_ref: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">source_url</span>
                    <input
                      className="nx-input"
                      value={sourceForm.source_url}
                      onChange={(e) => setSourceForm((s) => ({ ...s, source_url: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">published_on</span>
                    <input
                      className="nx-input"
                      type="date"
                      value={sourceForm.published_on}
                      onChange={(e) => setSourceForm((s) => ({ ...s, published_on: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">owner_note</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={sourceForm.owner_note}
                      onChange={(e) => setSourceForm((s) => ({ ...s, owner_note: e.target.value }))}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'create_tax_rule' || dialogKind === 'update_tax_rule_metadata' ? (
                <div className="nx-form-grid">
                  {dialogKind === 'create_tax_rule' ? (
                    <label className="nx-field">
                      <span className="nx-field-label">rule_code</span>
                      <input
                        className="nx-input"
                        value={ruleForm.rule_code}
                        onChange={(e) => setRuleForm((s) => ({ ...s, rule_code: e.target.value }))}
                      />
                    </label>
                  ) : null}
                  <label className="nx-field">
                    <span className="nx-field-label">title</span>
                    <input
                      className="nx-input"
                      value={ruleForm.title}
                      onChange={(e) => setRuleForm((s) => ({ ...s, title: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">usage_hint</span>
                    <input
                      className="nx-input"
                      value={ruleForm.usage_hint}
                      onChange={(e) => setRuleForm((s) => ({ ...s, usage_hint: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">owner_note</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={ruleForm.owner_note}
                      onChange={(e) => setRuleForm((s) => ({ ...s, owner_note: e.target.value }))}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'activate_tax_source' && selectedSource ? (
                <p style={{ fontSize: 14, margin: 0 }}>
                  {selectedSource.source_code}
                  {selectedSource.title ? ` — ${selectedSource.title}` : ''}
                </p>
              ) : null}
              {dialogKind === 'create_tax_rule_version' || dialogKind === 'update_tax_rule_version_draft' ? (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">country_pack_id</span>
                    <select
                      className="nx-select"
                      value={versionForm.country_pack_id}
                      onChange={(e) =>
                        setVersionForm((s) => ({
                          ...s,
                          country_pack_id: e.target.value,
                          country_pack_ruleset_id: '',
                        }))
                      }
                    >
                      <option value="">Select country pack</option>
                      {packsForSelectedRule.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.pack_code || pack.id}
                          {pack.name ? ` — ${pack.name}` : ''}
                          {pack.status ? ` (${pack.status})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">country_pack_ruleset_id</span>
                    <select
                      className="nx-select"
                      value={versionForm.country_pack_ruleset_id}
                      onChange={(e) =>
                        setVersionForm((s) => ({ ...s, country_pack_ruleset_id: e.target.value }))
                      }
                    >
                      <option value="">Select ruleset</option>
                      {rulesetsForSelectedPack.map((ruleset) => (
                        <option key={ruleset.id} value={ruleset.id}>
                          {ruleset.ruleset_code || ruleset.id}
                          {ruleset.ruleset_version ? ` ${ruleset.ruleset_version}` : ''}
                          {ruleset.status ? ` (${ruleset.status})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">effective_from</span>
                    <input
                      className="nx-input"
                      type="date"
                      value={versionForm.effective_from}
                      onChange={(e) => setVersionForm((s) => ({ ...s, effective_from: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">effective_to</span>
                    <input
                      className="nx-input"
                      type="date"
                      value={versionForm.effective_to}
                      onChange={(e) => setVersionForm((s) => ({ ...s, effective_to: e.target.value }))}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">payload_json</span>
                    <textarea
                      className="nx-textarea"
                      rows={8}
                      value={versionForm.payload_json}
                      onChange={(e) => setVersionForm((s) => ({ ...s, payload_json: e.target.value }))}
                      spellCheck={false}
                      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'pin_tax_rule_version_source' ? (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">tax_source_id</span>
                    <select
                      className="nx-select"
                      value={pinForm.tax_source_id}
                      onChange={(e) => setPinForm((s) => ({ ...s, tax_source_id: e.target.value }))}
                    >
                      <option value="">Select source</option>
                      {sourcesForSelectedVersion.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.source_code}
                          {source.title ? ` — ${source.title}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">locator</span>
                    <input
                      className="nx-input"
                      value={pinForm.locator}
                      onChange={(e) => setPinForm((s) => ({ ...s, locator: e.target.value }))}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'unpin_tax_rule_version_source' && pendingCitation ? (
                <p style={{ fontSize: 14, margin: 0 }}>
                  {pendingCitation.source_code}
                  {pendingCitation.title ? ` — ${pendingCitation.title}` : ''}
                  {pendingCitation.locator ? ` · ${pendingCitation.locator}` : ''}
                </p>
              ) : null}
              {dialogKind === 'bind_tax_rule_version_legal_value' ? (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">legal_value_id</span>
                    <select
                      className="nx-select"
                      value={bindLegalValueId}
                      onChange={(e) => setBindLegalValueId(e.target.value)}
                    >
                      <option value="">Select legal value</option>
                      {legalValuesForSelectedVersion.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.value_key}
                          {row.label ? ` — ${row.label}` : ''}
                          {row.category ? ` · ${row.category}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
              {dialogKind === 'unbind_tax_rule_version_legal_value' && pendingBinding ? (
                <p style={{ fontSize: 14, margin: 0 }}>
                  {pendingBinding.value_key}
                  {pendingBinding.label ? ` — ${pendingBinding.label}` : ''}
                </p>
              ) : null}
              {dialogKind === 'create_tax_rule_relationship' ? (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">relationship_type</span>
                    <select
                      className="nx-select"
                      value={relationshipForm.relationship_type}
                      onChange={(e) =>
                        setRelationshipForm((s) => ({ ...s, relationship_type: e.target.value }))
                      }
                    >
                      {TAX_KNOWLEDGE_RELATIONSHIP_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  {relationshipForm.relationship_type === 'procedural_requirement' ? (
                    <label className="nx-field">
                      <span className="nx-field-label">activation_critical</span>
                      <select
                        className="nx-select"
                        value={relationshipForm.activation_critical}
                        onChange={(e) =>
                          setRelationshipForm((s) => ({ ...s, activation_critical: e.target.value }))
                        }
                      >
                        <option value="">Select</option>
                        <option value="true">Mandatory to apply the rule</option>
                        <option value="false">Procedural guidance only</option>
                      </select>
                    </label>
                  ) : null}
                  <label className="nx-field">
                    <span className="nx-field-label">to_tax_rule_version_id</span>
                    <select
                      className="nx-select"
                      value={relationshipForm.to_tax_rule_version_id}
                      onChange={(e) =>
                        setRelationshipForm((s) => ({ ...s, to_tax_rule_version_id: e.target.value }))
                      }
                    >
                      <option value="">Select target version</option>
                      {targetVersionsForRelationship.map(({ rule, version }) => (
                        <option key={version.id} value={version.id}>
                          {rule.rule_code} · version_no {version.version_no} · {version.status}
                          {rule.title ? ` — ${rule.title}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">owner_note</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={relationshipForm.owner_note}
                      onChange={(e) => setRelationshipForm((s) => ({ ...s, owner_note: e.target.value }))}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'delete_tax_rule_relationship' && pendingRelationship ? (
                <p style={{ fontSize: 14, margin: 0 }}>
                  {pendingRelationship.relationship_type}
                  {pendingRelationship.to_rule_code ? ` · ${pendingRelationship.to_rule_code}` : ''}
                  {` · version_no ${pendingRelationship.to_version_no}`}
                </p>
              ) : null}
              {dialogKind === 'retire_tax_source' && selectedSource ? (
                <div className="nx-form-grid">
                  <p style={{ fontSize: 14, margin: 0 }}>
                    {selectedSource.source_code}
                    {selectedSource.title ? ` — ${selectedSource.title}` : ''}
                  </p>
                  <label className="nx-field">
                    <span className="nx-field-label">reason</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={retireReason}
                      onChange={(e) => setRetireReason(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'activate_tax_rule_version' && selectedVersion && selectedRule ? (
                <p style={{ fontSize: 14, margin: 0 }}>
                  {selectedRule.rule_code} · version_no {selectedVersion.version_no} · {selectedVersion.status}
                </p>
              ) : null}
              {dialogKind === 'retire_tax_rule_version' && selectedVersion && selectedRule ? (
                <div className="nx-form-grid">
                  <p style={{ fontSize: 14, margin: 0 }}>
                    {selectedRule.rule_code} · version_no {selectedVersion.version_no} · {selectedVersion.status}
                  </p>
                  <label className="nx-field">
                    <span className="nx-field-label">reason</span>
                    <textarea
                      className="nx-textarea"
                      rows={3}
                      value={retireReason}
                      onChange={(e) => setRetireReason(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'close_tax_rule_version_effective_to' ? (
                <div className="nx-form-grid">
                  <label className="nx-field">
                    <span className="nx-field-label">effective_to</span>
                    <input
                      className="nx-input"
                      type="date"
                      value={closeEffectiveTo}
                      onChange={(e) => setCloseEffectiveTo(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              {dialogKind === 'supersede_tax_rule_version' ? (
                supersedePairs.length === 1 ? (
                  <p style={{ fontSize: 14, margin: 0 }}>
                    {versionPresentationLabel(supersedePairs[0].old_tax_rule_version_id, taxKnowledge.rules)}
                    {' → '}
                    {versionPresentationLabel(supersedePairs[0].new_tax_rule_version_id, taxKnowledge.rules)}
                  </p>
                ) : supersedePairs.length > 1 ? (
                  <div className="nx-form-grid">
                    <label className="nx-field">
                      <span className="nx-field-label">candidate</span>
                      <select
                        className="nx-select"
                        value={supersedeCandidateIndex < 0 ? '' : String(supersedeCandidateIndex)}
                        onChange={(e) =>
                          setSupersedeCandidateIndex(e.target.value === '' ? -1 : Number(e.target.value))
                        }
                      >
                        <option value="">Select pair</option>
                        {supersedePairs.map((pair, index) => (
                          <option
                            key={`${pair.old_tax_rule_version_id}-${pair.new_tax_rule_version_id}`}
                            value={String(index)}
                          >
                            {versionPresentationLabel(pair.old_tax_rule_version_id, taxKnowledge.rules)}
                            {' → '}
                            {versionPresentationLabel(pair.new_tax_rule_version_id, taxKnowledge.rules)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <p style={{ fontSize: 14, margin: 0 }}>No backend supersession pair is available.</p>
                )
              ) : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                disabled={busy}
                onClick={() => setDialogKind(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                disabled={busy}
                onClick={() => void submitDialog()}
              >
                {busy
                  ? '…'
                  : dialogKind === 'activate_tax_source' ||
                      dialogKind === 'retire_tax_source' ||
                      dialogKind === 'unpin_tax_rule_version_source' ||
                      dialogKind === 'unbind_tax_rule_version_legal_value' ||
                      dialogKind === 'delete_tax_rule_relationship' ||
                      dialogKind === 'activate_tax_rule_version' ||
                      dialogKind === 'retire_tax_rule_version' ||
                      dialogKind === 'supersede_tax_rule_version'
                    ? 'Confirm'
                    : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
