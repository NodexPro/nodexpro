import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import type {
  OwnerKnowledgeTrainerCandidate,
  OwnerKnowledgeTrainerSlice,
  OwnerLegalLibrarySource,
  OwnerStructureReviewSummary,
  OwnerStructureReviewTreeNode,
  TaxKnowledgeAggregate,
  UnknownRecord,
} from './owner-legal-control-types';
import '../styles/nx-modal.css';

const REVIEW_FILTER_LABELS: Record<string, string> = {
  all: 'All',
  high_confidence: 'High confidence',
  needs_review: 'Needs review',
  ocr_affected: 'OCR affected',
  rejected: 'Rejected',
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function OwnerKnowledgeTrainerPanel({
  taxKnowledge,
  uploadSource,
  busy,
  onCloseUpload,
  onCommand,
  onUpload,
  onReload,
}: {
  taxKnowledge: TaxKnowledgeAggregate;
  uploadSource: OwnerLegalLibrarySource | null;
  busy: boolean;
  onCloseUpload: () => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
  onUpload: (payload: UnknownRecord) => Promise<void>;
  onReload: () => void;
}) {
  const trainer = taxKnowledge.legal_library.trainer_upload;
  const selectedCountry = taxKnowledge.selected_country_code;
  const countryName = taxKnowledge.countries.find((row) => row.code === selectedCountry)?.name || selectedCountry;
  const domainTitle =
    taxKnowledge.legal_library.domains.find((domain) => domain.sources.some((source) => source.id === uploadSource?.id))
      ?.title ?? '';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {uploadSource ? (
        <UploadMaterialModal
          trainer={trainer}
          countryName={countryName || ''}
          domainTitle={domainTitle}
          source={uploadSource}
          busy={busy}
          onClose={onCloseUpload}
          onUpload={onUpload}
        />
      ) : null}
      {trainer.selected_document ? (
        <TrainerReview
          taxKnowledge={taxKnowledge}
          trainer={trainer}
          busy={busy}
          onCommand={onCommand}
          onReload={onReload}
        />
      ) : null}
    </div>
  );
}

function UploadMaterialModal({
  trainer,
  countryName,
  domainTitle,
  source,
  busy,
  onClose,
  onUpload,
}: {
  trainer: OwnerKnowledgeTrainerSlice;
  countryName: string;
  domainTitle: string;
  source: OwnerLegalLibrarySource;
  busy: boolean;
  onClose: () => void;
  onUpload: (payload: UnknownRecord) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [provenance, setProvenance] = useState(source.provenance_type || 'official_law');
  const [error, setError] = useState('');
  const pdfOption = trainer.input_options.find((option) => option.input_type === 'pdf');
  const photoOption = trainer.input_options.find((option) => option.input_type === 'image');
  const textOption = trainer.input_options.find((option) => option.input_type === 'text');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!file) {
      setError('Choose a PDF');
      return;
    }
    try {
      const file_base64 = await fileToBase64(file);
      await onUpload({
        tax_source_id: source.id,
        input_type: 'pdf',
        mime_type: file.type || 'application/pdf',
        file_name: file.name,
        file_base64,
        provenance_type: provenance,
      });
      onClose();
    } catch (err) {
      setError(userFacingApiMessage(err));
    }
  };

  return (
    <div className="nx-modal-backdrop" role="presentation">
      <div className="nx-modal nx-accounting-editor-modal" role="dialog" aria-labelledby="trainer-upload-title">
        <div className="nx-modal-header">
          <h2 id="trainer-upload-title" style={{ margin: 0, fontSize: 18 }}>
            Upload legal material
          </h2>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <div className="nx-modal-body" style={{ display: 'grid', gap: 12 }}>
            <div>
              Country: <strong>{countryName}</strong>
            </div>
            <div dir="auto">
              Domain: <strong>{domainTitle || '—'}</strong>
            </div>
            <div dir="auto">
              Source: <strong>{source.title}</strong>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Input</div>
              <div style={{ display: 'grid', gap: 6 }}>
                <label>
                  <input type="radio" checked readOnly /> PDF — {pdfOption?.status_label || 'Available'}
                </label>
                <label style={{ color: '#6b7280' }}>
                  <input type="radio" disabled /> Photos — {photoOption?.status_label || 'Coming next'}
                </label>
                <label style={{ color: '#6b7280' }}>
                  <input type="radio" disabled /> Text — {textOption?.status_label || 'Coming next'}
                </label>
              </div>
            </div>
            <label>
              Provenance
              <select
                className="nx-input"
                value={provenance}
                onChange={(event) => setProvenance(event.target.value)}
                disabled={busy}
              >
                {taxKnowledgeProvenanceOptions(trainer, source).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="file"
              accept="application/pdf"
              disabled={busy || trainer.available !== true}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}
          </div>
          <div className="nx-modal-footer nx-tax-nested-modal-footer">
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
              Close
            </button>
            <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy || trainer.available !== true}>
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function taxKnowledgeProvenanceOptions(trainer: OwnerKnowledgeTrainerSlice, source: OwnerLegalLibrarySource): string[] {
  const fromDocs = trainer.documents.map((row) => row.provenance_type);
  return Array.from(new Set([source.provenance_type, ...fromDocs, 'official_law', 'textbook', 'professional_material', 'other']));
}

function TrainerReview({
  taxKnowledge,
  trainer,
  busy,
  onCommand,
  onReload,
}: {
  taxKnowledge: TaxKnowledgeAggregate;
  trainer: OwnerKnowledgeTrainerSlice;
  busy: boolean;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
  onReload: () => void;
}) {
  const document = trainer.selected_document;
  if (!document) return null;
  const processing = ['uploaded', 'queued', 'extracting'].includes(document.job_status);
  const [candidateId, setCandidateId] = useState(document.candidates[0]?.id ?? '');
  const [filterKey, setFilterKey] = useState(document.review_filters[0]?.key || 'all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [kindLabel, setKindLabel] = useState('');
  const [nodeNumber, setNodeNumber] = useState('');
  const [title, setTitle] = useState('');
  const [parentCandidateId, setParentCandidateId] = useState('');
  const [error, setError] = useState('');
  const [pageUrl, setPageUrl] = useState('');

  const candidateById = useMemo(() => {
    const map = new Map<string, OwnerKnowledgeTrainerCandidate>();
    for (const row of document.candidates) map.set(row.id, row);
    return map;
  }, [document.candidates]);

  const candidate = useMemo(
    () => candidateById.get(candidateId) ?? document.candidates[0] ?? null,
    [candidateById, candidateId, document.candidates],
  );

  const visibleTree = useMemo(
    () => filterReviewTree(document.structure_tree, candidateById, filterKey, search),
    [document.structure_tree, candidateById, filterKey, search],
  );

  const pdfSrc = useMemo(() => {
    if (!pageUrl) return '';
    const base = pageUrl.split('#')[0];
    const page = candidate?.page_start;
    return page && page > 0 ? `${base}#page=${page}` : base;
  }, [pageUrl, candidate?.page_start]);

  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => onReload(), 4000);
    return () => window.clearInterval(timer);
  }, [processing, onReload]);

  useEffect(() => {
    if (!candidate) return;
    setKindLabel(candidate.kind_label ?? '');
    setNodeNumber(candidate.node_number ?? '');
    setTitle(candidate.title ?? '');
    setParentCandidateId(candidate.parent_candidate_id ?? '');
    setEditing(false);
  }, [candidate]);

  useEffect(() => {
    let cancelled = false;
    if (!document.can_open_original) return;
    void apiJson(OWNER.legalTrainingDocumentFile(document.id))
      .then((out) => {
        if (!cancelled && out && typeof out === 'object' && 'signed_url' in out) {
          setPageUrl(String((out as { signed_url: string }).signed_url));
        }
      })
      .catch(() => {
        if (!cancelled) setPageUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [document.can_open_original, document.id]);

  const saveEdit = async () => {
    if (!candidate) return;
    setError('');
    try {
      await onCommand('update_legal_extraction_candidate', {
        legal_ingestion_candidate_id: candidate.id,
        kind_label: kindLabel,
        node_number: nodeNumber,
        title,
        parent_candidate_id: parentCandidateId || null,
      });
      setEditing(false);
    } catch (err) {
      setError(userFacingApiMessage(err));
    }
  };

  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>Knowledge Trainer</h3>
      <div>
        Document: <strong>{document.original_filename}</strong>
      </div>
      <div>Pages: {document.page_count || '—'}</div>
      <div>Status: {document.job_status_label}</div>
      <div>
        Progress: {document.extracted_page_count} / {document.page_count || '—'}
      </div>
      <div>Needs OCR: {document.needs_ocr_page_count}</div>
      <div>Failed: {document.failed_page_count}</div>
      <div>Structure candidates: {document.structure_candidate_count}</div>
      {document.structure_analysis ? (
        <div style={{ fontSize: 13, color: '#374151', display: 'grid', gap: 4 }}>
          <div>Candidates found: {document.structure_analysis.candidates_found}</div>
          <div>Rejected as table of contents / index: {document.structure_analysis.toc_index_rejected}</div>
          <div>Low confidence: {document.structure_analysis.low_confidence_count}</div>
          <div>Unresolved parent: {document.structure_analysis.unresolved_parent_count}</div>
          {document.structure_analysis.ocr_gap_warning ? (
            <div>
              Some pages still need OCR
              {document.ocr_page_numbers.length ? ` (${document.ocr_page_numbers.join(', ')})` : ''}; hierarchy near
              those pages may be incomplete.
            </div>
          ) : null}
        </div>
      ) : null}
      <ReviewSummary summary={document.review_summary} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {document.review_filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            aria-pressed={filterKey === filter.key}
            onClick={() => setFilterKey(filter.key)}
            style={filterKey === filter.key ? { outline: '2px solid #2563eb' } : undefined}
          >
            {filter.label || REVIEW_FILTER_LABELS[filter.key]} ({filter.count})
          </button>
        ))}
      </div>
      <label>
        Search by סעיף number or title
        <input
          className="nx-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="1 / הגדרות / חלק א"
        />
      </label>
      {document.can_rebuild_structure ? (
        <div>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || processing}
            onClick={() =>
              void onCommand('rebuild_legal_structure_candidates', {
                legal_ingestion_document_id: document.id,
              }).catch((err) => setError(userFacingApiMessage(err)))
            }
          >
            Rebuild structure candidates
          </button>
        </div>
      ) : null}
      {processing ? <div style={{ color: '#6b7280' }}>Processing…</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Original source</div>
          {pdfSrc ? (
            <iframe
              key={pdfSrc}
              title="Original legal material"
              src={pdfSrc}
              style={{ width: '100%', minHeight: 360, border: '1px solid #e5e7eb' }}
            />
          ) : (
            <pre
              dir="auto"
              style={{
                whiteSpace: 'pre-wrap',
                background: '#f9fafb',
                padding: 10,
                minHeight: 200,
                fontSize: 13,
              }}
            >
              {document.selected_page?.text || 'No extracted text for this page.'}
            </pre>
          )}
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
            {candidate?.page_start ? `Original PDF page ${candidate.page_start}` : null}
            {document.selected_page && !pdfSrc ? ` · extracted page ${document.selected_page.page_no}` : null}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Draft structure</div>
          <StructureReviewTree
            nodes={visibleTree}
            candidateById={candidateById}
            selectedId={candidate?.id ?? ''}
            onSelect={setCandidateId}
          />
          {candidate ? (
            <CandidateEditor
              candidate={candidate}
              candidates={document.candidates}
              kinds={taxKnowledge.legal_library.node_kinds.map((kind) => kind.label)}
              editing={editing}
              kindLabel={kindLabel}
              nodeNumber={nodeNumber}
              title={title}
              parentCandidateId={parentCandidateId}
              busy={busy}
              onKindLabel={setKindLabel}
              onNodeNumber={setNodeNumber}
              onTitle={setTitle}
              onParent={setParentCandidateId}
              onEdit={() => setEditing(true)}
              onSave={() => void saveEdit()}
              onAccept={() =>
                void onCommand('accept_legal_structure_candidate', {
                  legal_ingestion_candidate_id: candidate.id,
                }).catch((err) => setError(userFacingApiMessage(err)))
              }
              onReject={() =>
                void onCommand('reject_legal_extraction_candidate', {
                  legal_ingestion_candidate_id: candidate.id,
                }).catch((err) => setError(userFacingApiMessage(err)))
              }
            />
          ) : (
            <div style={{ color: '#6b7280' }}>No structure candidates yet.</div>
          )}
          {error ? <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</div> : null}
        </div>
      </div>
    </section>
  );
}

function CandidateEditor({
  candidate,
  candidates,
  kinds,
  editing,
  kindLabel,
  nodeNumber,
  title,
  parentCandidateId,
  busy,
  onKindLabel,
  onNodeNumber,
  onTitle,
  onParent,
  onEdit,
  onSave,
  onAccept,
  onReject,
}: {
  candidate: OwnerKnowledgeTrainerCandidate;
  candidates: OwnerKnowledgeTrainerCandidate[];
  kinds: string[];
  editing: boolean;
  kindLabel: string;
  nodeNumber: string;
  title: string;
  parentCandidateId: string;
  busy: boolean;
  onKindLabel: (value: string) => void;
  onNodeNumber: (value: string) => void;
  onTitle: (value: string) => void;
  onParent: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const locked = candidate.candidate_status === 'accepted' || candidate.candidate_status === 'rejected';
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#1f2937' }}>
        Review class: <strong>{candidate.review_class_label || candidate.review_class || '—'}</strong>
        {candidate.ocr_affected ? ' · OCR affected' : ''}
        {candidate.hierarchy_valid ? '' : ' · hierarchy needs review'}
      </div>
      {candidate.hierarchy_path ? (
        <div dir="auto" style={{ fontSize: 12, color: '#6b7280' }}>
          {candidate.hierarchy_path}
        </div>
      ) : null}
      <label>
        Type
        {editing ? (
          <select className="nx-input" value={kindLabel} onChange={(event) => onKindLabel(event.target.value)}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        ) : (
          <div dir="auto">{candidate.kind_label || '—'}</div>
        )}
      </label>
      <label>
        Number
        {editing ? (
          <input className="nx-input" value={nodeNumber} onChange={(event) => onNodeNumber(event.target.value)} />
        ) : (
          <div dir="auto">{candidate.node_number || '—'}</div>
        )}
      </label>
      <label>
        Official title
        {editing ? (
          <input className="nx-input" value={title} onChange={(event) => onTitle(event.target.value)} />
        ) : (
          <div dir="auto">{candidate.title || '—'}</div>
        )}
      </label>
      <label>
        Parent
        {editing ? (
          <select className="nx-input" value={parentCandidateId} onChange={(event) => onParent(event.target.value)}>
            <option value="">None</option>
            {candidates
              .filter((row) => row.id !== candidate.id)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.kind_label} {row.node_number || ''} {row.title || ''}
                </option>
              ))}
          </select>
        ) : (
          <div dir="auto">{candidate.parent_label || 'None'}</div>
        )}
      </label>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        Page {candidate.page_start ?? '—'}
        {candidate.page_end && candidate.page_end !== candidate.page_start ? `–${candidate.page_end}` : ''}
        {candidate.confidence != null ? ` · confidence ${candidate.confidence}` : ''}
        {candidate.possible_existing_match ? ' · possible existing match' : ''}
      </div>
      {(candidate.display_warnings.length ? candidate.display_warnings : candidate.validation_warnings).length ? (
        <div style={{ fontSize: 12, color: '#92400e' }}>
          Warnings: {(candidate.display_warnings.length ? candidate.display_warnings : candidate.validation_warnings).join(' · ')}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {editing ? (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onSave}>
            Save draft
          </button>
        ) : (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || locked} onClick={onEdit}>
            Edit Draft
          </button>
        )}
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || locked || editing}
          onClick={onAccept}
        >
          Accept Draft
        </button>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy || locked || editing}
          onClick={onReject}
        >
          Reject
        </button>
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Technical details</summary>
        <div style={{ fontSize: 12, color: '#4b5563' }}>
          status: {candidate.candidate_status}
          <br />
          kind: {candidate.candidate_kind}
        </div>
      </details>
    </div>
  );
}

function ReviewSummary({ summary }: { summary: OwnerStructureReviewSummary }) {
  const kinds = Object.entries(summary.by_kind);
  return (
    <div style={{ fontSize: 13, color: '#374151', display: 'grid', gap: 4 }}>
      <div>
        Review: {summary.all} all · {summary.high_confidence} high confidence · {summary.needs_owner_review} needs
        review · {summary.ocr_affected} OCR affected · {summary.rejected_technical} rejected technical
        {summary.already_accepted ? ` · ${summary.already_accepted} accepted` : ''}
        {summary.already_rejected ? ` · ${summary.already_rejected} rejected` : ''}
      </div>
      {kinds.length ? (
        <div dir="auto">
          By type:{' '}
          {kinds
            .map(([kind, count]) => `${kind} ${count}`)
            .join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

function StructureReviewTree({
  nodes,
  candidateById,
  selectedId,
  onSelect,
}: {
  nodes: OwnerStructureReviewTreeNode[];
  candidateById: Map<string, OwnerKnowledgeTrainerCandidate>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (!nodes.length) {
    return <div style={{ color: '#6b7280', fontSize: 13 }}>No candidates match this filter.</div>;
  }
  return (
    <div
      style={{
        maxHeight: 320,
        overflow: 'auto',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 8,
        background: '#fff',
      }}
    >
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.candidate_id}
          node={node}
          depth={0}
          candidateById={candidateById}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  candidateById,
  selectedId,
  onSelect,
}: {
  node: OwnerStructureReviewTreeNode;
  depth: number;
  candidateById: Map<string, OwnerKnowledgeTrainerCandidate>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const candidate = candidateById.get(node.candidate_id);
  const selected = node.candidate_id === selectedId;
  const label = candidate
    ? [candidate.kind_label, candidate.node_number, candidate.title].filter(Boolean).join(' ')
    : node.candidate_id;
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.candidate_id)}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'start',
          padding: '6px 8px',
          marginInlineStart: depth * 14,
          border: 'none',
          borderRadius: 6,
          background: selected ? '#dbeafe' : 'transparent',
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: 1.3,
        }}
      >
        <span dir="auto">{label || '—'}</span>
        <span style={{ color: '#6b7280', marginInlineStart: 8 }}>
          {candidate?.review_class_label || ''}
          {candidate?.page_start ? ` · p.${candidate.page_start}` : ''}
        </span>
      </button>
      {node.children.map((child) => (
        <TreeNodeRow
          key={child.candidate_id}
          node={child}
          depth={depth + 1}
          candidateById={candidateById}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function filterReviewTree(
  nodes: OwnerStructureReviewTreeNode[],
  candidateById: Map<string, OwnerKnowledgeTrainerCandidate>,
  filterKey: string,
  search: string,
): OwnerStructureReviewTreeNode[] {
  const query = search.trim().toLowerCase();
  const keep = (node: OwnerStructureReviewTreeNode): OwnerStructureReviewTreeNode | null => {
    const children = node.children.map(keep).filter((row): row is OwnerStructureReviewTreeNode => row !== null);
    const candidate = candidateById.get(node.candidate_id);
    if (!candidate) return children.length ? { candidate_id: node.candidate_id, children } : null;
    const matchesFilter = candidateMatchesFilter(candidate, filterKey);
    const matchesSearch = !query || candidateSearchText(candidate).includes(query);
    if ((matchesFilter && matchesSearch) || children.length) {
      return { candidate_id: node.candidate_id, children };
    }
    return null;
  };
  return nodes.map(keep).filter((row): row is OwnerStructureReviewTreeNode => row !== null);
}

function candidateMatchesFilter(candidate: OwnerKnowledgeTrainerCandidate, filterKey: string): boolean {
  if (filterKey === 'all' || !filterKey) return true;
  if (filterKey === 'high_confidence') {
    return candidate.review_class === 'high_confidence' && candidate.candidate_status !== 'rejected';
  }
  if (filterKey === 'needs_review') return candidate.review_class === 'needs_owner_review';
  if (filterKey === 'ocr_affected') return candidate.ocr_affected === true;
  if (filterKey === 'rejected') {
    return candidate.review_class === 'rejected_technical' || candidate.candidate_status === 'rejected';
  }
  return true;
}

function candidateSearchText(candidate: OwnerKnowledgeTrainerCandidate): string {
  return [candidate.kind_label, candidate.node_number, candidate.title, candidate.hierarchy_path, candidate.parent_label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
