import { useEffect, useMemo, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import { LegalIdentifierText } from '../lib/legal-identifier-text';
import { nestLegalTextReviewNodes } from './owner-legal-text-draft-review.pure';
import type {
  OwnerLegalTextDraft,
  OwnerLegalTextDraftCreateFrontierItem,
  OwnerLegalTextDraftCounts,
  OwnerLegalTextDraftListItem,
  OwnerLegalTextReviewNode,
  OwnerSourceNote,
  UnknownRecord,
} from './owner-legal-control-types';

export function OwnerLegalTextDraftReview({
  documentId,
  drafts,
  selected,
  selectedNode,
  reviewTree,
  frontier,
  summary,
  kindLabels,
  canOpenOriginal,
  canPrepare,
  busy,
  onSelectNode,
  onCommand,
}: {
  documentId: string;
  drafts: OwnerLegalTextDraftListItem[];
  selected: OwnerLegalTextDraft | null;
  selectedNode: OwnerLegalTextReviewNode | null;
  reviewTree: OwnerLegalTextReviewNode[];
  frontier: OwnerLegalTextDraftCreateFrontierItem[];
  summary: OwnerLegalTextDraftCounts;
  kindLabels: string[];
  canOpenOriginal: boolean;
  canPrepare: boolean;
  busy: boolean;
  onSelectNode: (nodeId: string) => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const tree = useMemo(() => nestLegalTextReviewNodes(reviewTree), [reviewTree]);
  const [error, setError] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [subtreeOpen, setSubtreeOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [kindLabel, setKindLabel] = useState('');
  const [legalIdentifier, setLegalIdentifier] = useState('');
  const [printedMarker, setPrintedMarker] = useState('');
  const [title, setTitle] = useState('');
  const [parentDraftId, setParentDraftId] = useState('');
  const [draftText, setDraftText] = useState('');
  const [pageStart, setPageStart] = useState('');
  const [pageEnd, setPageEnd] = useState('');
  const [itemStart, setItemStart] = useState('');
  const [itemEnd, setItemEnd] = useState('');
  const [resetFromBoundary, setResetFromBoundary] = useState(false);

  useEffect(() => {
    if (!selected) {
      setKindLabel(selectedNode?.kind_label ?? '');
      setLegalIdentifier(selectedNode?.display_identifier ?? '');
      setPrintedMarker(selectedNode?.printed_marker ?? '');
      setTitle(selectedNode?.title ?? '');
      setParentDraftId('');
      setDraftText('');
      setPageStart('');
      setPageEnd('');
      setItemStart('');
      setItemEnd('');
      setResetFromBoundary(false);
      setError('');
      setSubtreeOpen(false);
      return;
    }
    setKindLabel(selected.kind_label ?? '');
    setLegalIdentifier(selected.display_identifier ?? '');
    setPrintedMarker(selected.printed_marker ?? '');
    setTitle(selected.title ?? '');
    setParentDraftId(selected.parent_draft_id ?? '');
    setDraftText(selected.draft_legal_text ?? '');
    setPageStart(String(selected.owner_source_page_start ?? selected.source_page_start ?? ''));
    setPageEnd(String(selected.owner_source_page_end ?? selected.source_page_end ?? ''));
    setItemStart(
      selected.owner_source_item_start == null && selected.source_item_start == null
        ? ''
        : String(selected.owner_source_item_start ?? selected.source_item_start),
    );
    setItemEnd(
      selected.owner_source_item_end == null && selected.source_item_end == null
        ? ''
        : String(selected.owner_source_item_end ?? selected.source_item_end),
    );
    setResetFromBoundary(false);
    setError('');
    setSubtreeOpen(false);
  }, [selected, selectedNode]);

  const run = async (command: string, payload: UnknownRecord) => {
    setError('');
    try {
      await onCommand(command, payload);
    } catch (err) {
      setError(userFacingApiMessage(err));
    }
  };

  const openPdf = async () => {
    setError('');
    try {
      const out = (await apiJson(OWNER.legalTrainingDocumentFile(documentId))) as { signed_url?: string };
      if (!out.signed_url) throw new Error('Original PDF is not available');
      setPdfUrl(out.signed_url);
      setPdfOpen(true);
    } catch (err) {
      setError(userFacingApiMessage(err));
    }
  };

  const remaining = summary.not_prepared;
  const reviewLabel = selectedNode?.review_state_label || (selected ? 'Draft / טיוטה' : 'Not prepared / טרם הוכן');

  return (
    <section className="nx-legal-draft-review" dir="rtl">
      <div className="nx-legal-draft-review-header">
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>Owner Legal Draft</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#4b5563' }}>
            Review this law against the original source. Reviewed means only that the Owner checked this Draft against
            source. It is not canonical, published, accepted, or active.
          </p>
        </div>
        {canOpenOriginal ? (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void openPdf()}>
            Open original PDF
          </button>
        ) : null}
      </div>
      <div className="nx-legal-draft-progress">
        {summary.structure_candidates ? (
          <span>
            {summary.all} prepared · {summary.needs_review} needs review · {summary.reviewed} reviewed · {remaining} not
            prepared
          </span>
        ) : (
          <span>No structure is ready for this document.</span>
        )}
        {canPrepare && remaining > 0 ? (
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={() =>
              void run('prepare_legal_text_drafts_for_structure', {
                legal_ingestion_document_id: documentId,
              })
            }
          >
            {summary.all ? 'Prepare remaining drafts' : 'Prepare drafts for this law'}
          </button>
        ) : null}
      </div>
      {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}
      {pdfOpen && pdfUrl ? <iframe title="Original legal PDF" src={pdfUrl} className="nx-legal-draft-pdf" /> : null}

      <div className="nx-legal-draft-review-grid">
        <aside className="nx-legal-draft-tree">
          <div style={{ fontWeight: 600 }}>Law tree</div>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Where am I in the law?</p>
          {tree.length ? (
            <DraftTree nodes={tree} selectedId={selectedNode?.id ?? selected?.id ?? ''} onSelect={onSelectNode} />
          ) : (
            <div style={{ fontSize: 13, color: '#6b7280' }}>No structure for this document yet.</div>
          )}
        </aside>

        <section className="nx-legal-draft-source">
          <div style={{ fontWeight: 600 }}>Original source — read only</div>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>What did the original source say?</p>
          {!selectedNode ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Select a section in the law tree.</p>
          ) : !selected ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              This section is not prepared yet. Use Prepare drafts for this law.
            </p>
          ) : (
            <>
              {!selected.original_source_text.trim() || selected.text_boundary_status === 'uncertain' ? (
                <div className="nx-legal-draft-banner">Source boundary needs review</div>
              ) : null}
              {selected.text_boundary_status === 'owner_defined' ? (
                <div style={{ fontSize: 12, color: '#6b7280' }}>Owner-defined source region</div>
              ) : null}
              <pre className="nx-legal-draft-readonly" dir="auto">
                {selected.original_source_text || 'Source boundary needs review'}
              </pre>
              <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => setSubtreeOpen((open) => !open)}>
                {subtreeOpen ? 'Hide full source region' : 'Full source region'}
              </button>
              {subtreeOpen ? (
                <pre className="nx-legal-draft-readonly" dir="auto">
                  {selected.original_subtree_text || 'No subtree source stored'}
                </pre>
              ) : null}
              <SourceNotesBlock title="Source references / הערות מקור" notes={selected.source_notes} />
              {subtreeOpen ? (
                <SourceNotesBlock title="Subtree source references" notes={selected.subtree_source_notes} />
              ) : null}
            </>
          )}
        </section>

        <section className="nx-legal-draft-editor">
          <div style={{ fontWeight: 600 }}>Owner version</div>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>What text will I keep or correct?</p>
          {!selectedNode ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Select a section in the law tree.</p>
          ) : !selected ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Prepare drafts before editing this section.</p>
          ) : (
            <>
              <div className="nx-legal-draft-review-flag">
                Have I reviewed this node? <strong>{reviewLabel}</strong>
              </div>
              <label className="nx-field">
                <span className="nx-field-label">Type</span>
                <select className="nx-input" value={kindLabel} onChange={(event) => setKindLabel(event.target.value)} disabled={busy}>
                  {kindOptions(kindLabels, kindLabel).map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="nx-field">
                <span className="nx-field-label">Legal identifier</span>
                <input
                  className="nx-input"
                  dir="ltr"
                  value={legalIdentifier}
                  onChange={(event) => setLegalIdentifier(event.target.value)}
                  disabled={busy}
                />
              </label>
              <div style={{ fontSize: 13 }}>
                Displayed: <LegalIdentifierText value={selected.display_identifier} />
              </div>
              <label className="nx-field">
                <span className="nx-field-label">Printed marker</span>
                <input
                  className="nx-input"
                  dir="ltr"
                  value={printedMarker}
                  onChange={(event) => setPrintedMarker(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="nx-field">
                <span className="nx-field-label">Title</span>
                <input className="nx-input" dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
              </label>
              <label className="nx-field">
                <span className="nx-field-label">Parent</span>
                <select className="nx-input" value={parentDraftId} onChange={(event) => setParentDraftId(event.target.value)} disabled={busy}>
                  <option value="">None</option>
                  {drafts
                    .filter((row) => row.id !== selected.id)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.display_label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="nx-field">
                <span className="nx-field-label">Editable legal text</span>
                <textarea
                  className="nx-input nx-legal-draft-textarea"
                  dir="auto"
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  disabled={busy}
                />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('update_legal_text_draft_text', {
                      legal_text_draft_id: selected.id,
                      draft_legal_text: draftText,
                    })
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => void run('reset_legal_text_draft_to_source', { legal_text_draft_id: selected.id })}
                >
                  Reset text from original
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('update_legal_text_draft_identity', {
                      legal_text_draft_id: selected.id,
                      kind_label: kindLabel,
                      legal_identifier: legalIdentifier,
                      printed_marker: printedMarker,
                      title,
                    })
                  }
                >
                  Save heading
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('reparent_legal_text_draft', {
                      legal_text_draft_id: selected.id,
                      parent_draft_id: parentDraftId || null,
                    })
                  }
                >
                  Save parent
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#4b5563' }}>
                Reviewed / נבדק means the Owner checked this Draft against source. It does not mean canonical,
                published, accepted, or active.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('set_legal_text_draft_review_status', {
                      legal_text_draft_id: selected.id,
                      review_status: 'ready',
                    })
                  }
                >
                  Mark reviewed / נבדק
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('set_legal_text_draft_review_status', {
                      legal_text_draft_id: selected.id,
                      review_status: 'needs_review',
                    })
                  }
                >
                  Needs review / דורש בדיקה
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <details
        className="nx-legal-draft-advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>Technical details / Advanced source correction</summary>
        <p style={{ fontSize: 12, color: '#6b7280' }}>
          Detector coordinates, internal IDs, and one-by-one Draft creation. Not part of the normal review workflow.
        </p>
        {selected ? (
          <>
            <div style={{ fontSize: 12, color: '#4b5563' }}>
              Draft id: {selected.id}
              <br />
              Source candidate: {selected.provenance.source_candidate_id || '—'}
              <br />
              Structure run: {selected.provenance.structure_run_id || '—'}
              <br />
              Original span p.{selected.source_page_start ?? '—'}
              {selected.source_item_start != null ? ` item ${selected.source_item_start}` : ''}
              {' → '}
              p.{selected.source_page_end ?? '—'}
              {selected.source_item_end != null ? ` item ${selected.source_item_end}` : ''}
            </div>
            <div className="nx-legal-draft-boundary">
              <label>
                Page start
                <input className="nx-input" value={pageStart} onChange={(event) => setPageStart(event.target.value)} disabled={busy} />
              </label>
              <label>
                Page end
                <input className="nx-input" value={pageEnd} onChange={(event) => setPageEnd(event.target.value)} disabled={busy} />
              </label>
              <label>
                Item start
                <input className="nx-input" value={itemStart} onChange={(event) => setItemStart(event.target.value)} disabled={busy} />
              </label>
              <label>
                Item end
                <input className="nx-input" value={itemEnd} onChange={(event) => setItemEnd(event.target.value)} disabled={busy} />
              </label>
            </div>
            <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={resetFromBoundary}
                onChange={(event) => setResetFromBoundary(event.target.checked)}
                disabled={busy}
              />
              Also replace draft text from this boundary
            </label>
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={busy}
              onClick={() =>
                void run('set_legal_text_draft_boundary', {
                  legal_text_draft_id: selected.id,
                  owner_source_page_start: Number(pageStart),
                  owner_source_page_end: Number(pageEnd || pageStart),
                  owner_source_item_start: itemStart === '' ? null : Number(itemStart),
                  owner_source_item_end: itemEnd === '' ? null : Number(itemEnd),
                  reset_from_boundary: resetFromBoundary,
                })
              }
            >
              Save boundary
            </button>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#6b7280' }}>Select a prepared Draft to correct source coordinates.</div>
        )}
        <div style={{ fontWeight: 600, marginTop: 12 }}>Create one Owner Draft</div>
        {frontier.length ? (
          <ul className="nx-legal-draft-frontier">
            {frontier.map((row) => (
              <li key={row.candidate_id}>
                <div>
                  {row.kind_label ? <span>{row.kind_label} </span> : null}
                  <LegalIdentifierText value={row.display_identifier} />
                </div>
                {row.parent_draft_required ? (
                  <div style={{ fontSize: 12, color: '#92400e' }}>Create the parent Owner Draft first.</div>
                ) : null}
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('create_legal_text_draft_from_candidate', {
                      legal_ingestion_document_id: documentId,
                      legal_ingestion_candidate_id: row.candidate_id,
                    })
                  }
                >
                  Create Owner Draft
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 13, color: '#6b7280' }}>No parent-ready structure candidates without a Draft.</div>
        )}
      </details>
    </section>
  );
}

function kindOptions(labels: string[], current: string): string[] {
  const set = new Set(labels.filter(Boolean));
  if (current) set.add(current);
  return Array.from(set);
}

function DraftTree({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: ReturnType<typeof nestLegalTextReviewNodes<OwnerLegalTextReviewNode>>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="nx-legal-draft-tree-list">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            className={node.id === selectedId ? 'nx-legal-draft-tree-item is-selected' : 'nx-legal-draft-tree-item'}
            onClick={() => onSelect(node.id)}
          >
            {node.kind_label ? <span>{node.kind_label} </span> : null}
            <LegalIdentifierText value={node.display_identifier} />
            {node.printed_marker && node.printed_marker !== node.display_identifier ? (
              <span> {node.printed_marker}</span>
            ) : null}
            {node.title ? <span> {node.title}</span> : null}
            <span className={`nx-legal-draft-status is-${node.review_state}`}> {node.review_state_label}</span>
          </button>
          {node.children.length ? <DraftTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} /> : null}
        </li>
      ))}
    </ul>
  );
}

function SourceNotesBlock({ title, notes }: { title: string; notes: OwnerSourceNote[] }) {
  return (
    <div className="nx-legal-draft-notes">
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      {notes.length ? (
        notes.map((note) => (
          <div key={note.id} className="nx-legal-draft-note" dir="auto">
            <div>
              {note.printed_marker ? `[${note.printed_marker}] ` : ''}
              {note.note_text}
            </div>
            {note.inline_link_status !== 'linked' || note.review_status === 'unresolved' ? (
              <div style={{ fontSize: 12, color: '#92400e' }}>unresolved</div>
            ) : null}
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280' }}>No overlapping source notes.</div>
      )}
    </div>
  );
}
