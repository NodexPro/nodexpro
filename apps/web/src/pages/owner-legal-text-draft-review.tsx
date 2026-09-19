import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import { LegalIdentifierText } from '../lib/legal-identifier-text';
import {
  matchLegalTextSearchIndex,
  mergeExpandedIds,
  nestLegalTextReviewNodes,
} from './owner-legal-text-draft-review.pure';
import type {
  OwnerLegalTextCompleteness,
  OwnerLegalTextDraft,
  OwnerLegalTextDraftCreateFrontierItem,
  OwnerLegalTextDraftCounts,
  OwnerLegalTextDraftListItem,
  OwnerLegalTextReviewNode,
  OwnerLegalTextSearchIndexItem,
  OwnerSourceNote,
  OwnerTaxKnowledgeProposalSlice,
  UnknownRecord,
} from './owner-legal-control-types';
import { emptyTaxKnowledgeProposalSlice } from './owner-legal-control-types';
import { OwnerTaxKnowledgeProposalView } from './owner-tax-knowledge-proposal-view';

export function OwnerLegalTextDraftReview({
  documentId,
  drafts,
  selected,
  selectedNode,
  reviewTree,
  searchIndex,
  completeness,
  proposals,
  frontier,
  summary,
  kindLabels,
  canOpenOriginal,
  canPrepare,
  canCreateManual,
  canConfirmCompleteness,
  busy,
  detailLoading,
  onSelectNode,
  onCommand,
}: {
  documentId: string;
  drafts: OwnerLegalTextDraftListItem[];
  selected: OwnerLegalTextDraft | null;
  selectedNode: OwnerLegalTextReviewNode | null;
  reviewTree: OwnerLegalTextReviewNode[];
  searchIndex: OwnerLegalTextSearchIndexItem[];
  completeness: OwnerLegalTextCompleteness | undefined;
  proposals?: OwnerTaxKnowledgeProposalSlice;
  frontier: OwnerLegalTextDraftCreateFrontierItem[];
  summary: OwnerLegalTextDraftCounts;
  kindLabels: string[];
  canOpenOriginal: boolean;
  canPrepare: boolean;
  canCreateManual: boolean;
  canConfirmCompleteness: boolean;
  busy: boolean;
  detailLoading: boolean;
  onSelectNode: (nodeId: string) => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const tree = useMemo(() => nestLegalTextReviewNodes(reviewTree), [reviewTree]);
  const [error, setError] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [subtreeOpen, setSubtreeOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(() =>
    mergeExpandedIds(
      new Set(),
      selectedNode?.ancestor_ids ?? [],
      reviewTree.filter((row) => row.default_expanded).map((row) => row.id),
    ),
  );
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const treeScrollTopRef = useRef(0);
  const pendingScrollNodeId = useRef<string | null>(null);

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
  const [addKind, setAddKind] = useState('');
  const [addIdentifier, setAddIdentifier] = useState('');
  const [addMarker, setAddMarker] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addParentId, setAddParentId] = useState('');
  const [addDraftText, setAddDraftText] = useState('');

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

  useEffect(() => {
    setExpandedIds((prev) =>
      mergeExpandedIds(
        prev,
        selectedNode?.ancestor_ids ?? [],
        reviewTree.filter((row) => row.default_expanded).map((row) => row.id),
      ),
    );
  }, [selectedNode?.id, selectedNode?.ancestor_ids, reviewTree]);

  useLayoutEffect(() => {
    const el = treeScrollRef.current;
    if (!el) return;
    if (pendingScrollNodeId.current) {
      const target = el.querySelector(`[data-tree-node-id="${pendingScrollNodeId.current}"]`);
      pendingScrollNodeId.current = null;
      target?.scrollIntoView({ block: 'nearest' });
      return;
    }
    el.scrollTop = treeScrollTopRef.current;
  }, [reviewTree, expandedIds, selectedNode?.id]);

  const searchHits = useMemo(() => matchLegalTextSearchIndex(searchIndex, searchQuery), [searchIndex, searchQuery]);

  const goToSearchHit = (hit: OwnerLegalTextSearchIndexItem) => {
    pendingScrollNodeId.current = hit.node_id;
    setExpandedIds((prev) => mergeExpandedIds(prev, hit.ancestor_ids));
    onSelectNode(hit.node_id);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async (command: string, payload: UnknownRecord) => {
    setError('');
    try {
      await onCommand(command, payload);
      return true;
    } catch (err) {
      setError(userFacingApiMessage(err));
      return false;
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
  const progress = selectedNode?.review_progress;
  const branchDraftId = selected?.id ?? selectedNode?.draft_id ?? '';
  const manuallyAdded =
    selected?.creation_origin === 'owner_manual' || selectedNode?.creation_origin === 'owner_manual';
  const completenessDto = completeness ?? {
    document_confirmed: false,
    document_confirmed_at: null,
    selected_branch_confirmed: false,
    selected_branch_confirmed_at: null,
  };

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
        <aside
          className="nx-legal-draft-tree"
          ref={treeScrollRef}
          onScroll={(event) => {
            treeScrollTopRef.current = event.currentTarget.scrollTop;
          }}
        >
          <div style={{ fontWeight: 600 }}>Law tree</div>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Where am I in the law?</p>
          <label className="nx-field">
            <span className="nx-field-label">Go to identifier</span>
            <input
              className="nx-input"
              dir="ltr"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="2 / 2(2) / 3(ט)"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchHits[0]) {
                  event.preventDefault();
                  goToSearchHit(searchHits[0]);
                }
              }}
            />
          </label>
          {searchQuery.trim() ? (
            <ul className="nx-legal-draft-search-hits">
              {searchHits.length ? (
                searchHits.slice(0, 20).map((hit) => (
                  <li key={hit.node_id}>
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      onClick={() => goToSearchHit(hit)}
                    >
                      <LegalIdentifierText value={hit.search_label} />
                    </button>
                  </li>
                ))
              ) : (
                <li style={{ fontSize: 12, color: '#6b7280' }}>No matching identifier</li>
              )}
            </ul>
          ) : null}
          {progress ? (
            <div className="nx-legal-draft-branch-progress">
              Reviewed {progress.reviewed} / {progress.all}
              {progress.needs_review ? ` · Needs review ${progress.needs_review}` : ''}
              {progress.not_prepared ? ` · Not prepared ${progress.not_prepared}` : ''}
              {progress.draft ? ` · Draft ${progress.draft}` : ''}
            </div>
          ) : null}
          {canConfirmCompleteness ? (
            <div className="nx-legal-draft-completeness-actions">
              <div style={{ fontSize: 12 }}>
                Structure completeness confirmed:{' '}
                {completenessDto.document_confirmed ? 'whole document yes' : 'whole document no'}
              </div>
              {completenessDto.document_confirmed ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('retract_owner_structure_completeness', {
                      legal_ingestion_document_id: documentId,
                      legal_text_draft_id: (selected?.id ?? branchDraftId) || null,
                    })
                  }
                >
                  Retract document completeness
                </button>
              ) : (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() =>
                    void run('confirm_owner_structure_completeness', {
                      legal_ingestion_document_id: documentId,
                      legal_text_draft_id: (selected?.id ?? branchDraftId) || null,
                    })
                  }
                >
                  Confirm whole document is complete
                </button>
              )}
            </div>
          ) : null}
          {tree.length ? (
            <DraftTree
              nodes={tree}
              selectedId={selectedNode?.id ?? selected?.id ?? ''}
              expandedIds={expandedIds}
              onToggle={toggleExpanded}
              onSelect={onSelectNode}
            />
          ) : (
            <div style={{ fontSize: 13, color: '#6b7280' }}>No structure for this document yet.</div>
          )}
          {canCreateManual ? (
            <div className="nx-legal-draft-add-missing">
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy}
                onClick={() => {
                  setAddOpen((open) => !open);
                  setAddKind(selectedNode?.kind_label || kindLabels[0] || '');
                  setAddIdentifier('');
                  setAddMarker('');
                  setAddTitle('');
                  setAddParentId(selected?.id ?? selectedNode?.draft_id ?? '');
                  setAddDraftText('');
                }}
              >
                + Add missing item
              </button>
              {addOpen ? (
                <div className="nx-legal-draft-add-form">
                  <label className="nx-field">
                    <span className="nx-field-label">Kind</span>
                    <select className="nx-input" value={addKind} onChange={(event) => setAddKind(event.target.value)} disabled={busy}>
                      {kindOptions(kindLabels, addKind).map((label) => (
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
                      value={addIdentifier}
                      onChange={(event) => setAddIdentifier(event.target.value)}
                      disabled={busy}
                      placeholder="2(5)"
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">Printed marker (optional)</span>
                    <input
                      className="nx-input"
                      dir="ltr"
                      value={addMarker}
                      onChange={(event) => setAddMarker(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">Title (optional)</span>
                    <input className="nx-input" dir="auto" value={addTitle} onChange={(event) => setAddTitle(event.target.value)} disabled={busy} />
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">Parent</span>
                    <select className="nx-input" value={addParentId} onChange={(event) => setAddParentId(event.target.value)} disabled={busy}>
                      <option value="">None</option>
                      {drafts.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.display_label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nx-field">
                    <span className="nx-field-label">Draft legal text</span>
                    <textarea
                      className="nx-input nx-legal-draft-textarea"
                      dir="auto"
                      value={addDraftText}
                      onChange={(event) => setAddDraftText(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy || !addKind || !addIdentifier.trim()}
                    onClick={() =>
                      void run('create_manual_legal_text_draft', {
                        legal_ingestion_document_id: documentId,
                        kind_label: addKind,
                        legal_identifier: addIdentifier,
                        printed_marker: addMarker || null,
                        title: addTitle || null,
                        parent_draft_id: addParentId || null,
                        draft_legal_text: addDraftText,
                      }).then((ok) => {
                        if (ok) setAddOpen(false);
                      })
                    }
                  >
                    Create missing item
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="nx-legal-draft-source">
          <div style={{ fontWeight: 600 }}>Original source — read only</div>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>What did the original source say?</p>
          {detailLoading ? <div className="nx-legal-draft-detail-loading">Loading section…</div> : null}
          {!selectedNode ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>Select a section in the law tree.</p>
          ) : !selected ? (
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              This section is not prepared yet. Use Prepare drafts for this law.
            </p>
          ) : manuallyAdded ? (
            <>
              <div className="nx-legal-draft-manual-badge">Manually added / נוסף ידנית</div>
              <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                No original source provenance. Manual text is stored only in the Owner Draft.
              </p>
            </>
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
          <OwnerTaxKnowledgeProposalView
            proposals={proposals ?? emptyTaxKnowledgeProposalSlice()}
            onCommand={onCommand}
          />
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
              {manuallyAdded ? <div className="nx-legal-draft-manual-badge">Manually added / נוסף ידנית</div> : null}
              {detailLoading ? <div className="nx-legal-draft-detail-loading">Loading section…</div> : null}
              <div className="nx-legal-draft-review-flag">
                Have I reviewed this node? Draft reviewed: <strong>{reviewLabel}</strong>
              </div>
              <div className="nx-legal-draft-completeness-flag">
                Structure completeness confirmed:{' '}
                <strong>
                  {completenessDto.selected_branch_confirmed
                    ? 'Yes — this branch was checked against the original source for missing items'
                    : 'No'}
                </strong>
              </div>
              <div className="nx-legal-draft-completeness-flag">
                Whole-document completeness:{' '}
                <strong>
                  {completenessDto.document_confirmed
                    ? 'Yes — this document was checked against the original source for missing items'
                    : 'No'}
                </strong>
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
                {!manuallyAdded ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => void run('reset_legal_text_draft_to_source', { legal_text_draft_id: selected.id })}
                >
                  Reset text from original
                </button>
                ) : null}
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
                published, accepted, or active. Structure completeness is a separate confirmation that this branch was
                checked against the original source for missing items.
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
              {canConfirmCompleteness ? (
                <div className="nx-legal-draft-completeness-actions">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Structure completeness</div>
                  <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
                    I checked this branch against the original source for missing items. This is not Draft reviewed.
                  </p>
                  {completenessDto.selected_branch_confirmed ? (
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      disabled={busy || !branchDraftId}
                      onClick={() =>
                        void run('retract_owner_structure_completeness', {
                          legal_ingestion_document_id: documentId,
                          branch_draft_id: branchDraftId,
                          legal_text_draft_id: selected.id,
                        })
                      }
                    >
                      Retract branch completeness
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      disabled={busy || !branchDraftId}
                      onClick={() =>
                        void run('confirm_owner_structure_completeness', {
                          legal_ingestion_document_id: documentId,
                          branch_draft_id: branchDraftId,
                          legal_text_draft_id: selected.id,
                        })
                      }
                    >
                      Confirm this branch is complete
                    </button>
                  )}
                  {completenessDto.document_confirmed ? (
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      disabled={busy}
                      onClick={() =>
                        void run('retract_owner_structure_completeness', {
                          legal_ingestion_document_id: documentId,
                          legal_text_draft_id: selected.id,
                        })
                      }
                    >
                      Retract document completeness
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      disabled={busy}
                      onClick={() =>
                        void run('confirm_owner_structure_completeness', {
                          legal_ingestion_document_id: documentId,
                          legal_text_draft_id: selected.id,
                        })
                      }
                    >
                      Confirm whole document is complete
                    </button>
                  )}
                </div>
              ) : null}
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
              Creation origin: {selected.creation_origin}
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
  expandedIds,
  onToggle,
  onSelect,
}: {
  nodes: ReturnType<typeof nestLegalTextReviewNodes<OwnerLegalTextReviewNode>>;
  selectedId: string;
  expandedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="nx-legal-draft-tree-list">
      {nodes.map((node) => {
        const expanded = expandedIds.has(node.id);
        const hasChildren = node.children.length > 0;
        return (
          <li key={node.id}>
            <div className="nx-legal-draft-tree-row">
              {hasChildren ? (
                <button
                  type="button"
                  className="nx-legal-draft-tree-toggle"
                  aria-expanded={expanded}
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                  onClick={() => onToggle(node.id)}
                >
                  {expanded ? '▾' : '▸'}
                </button>
              ) : (
                <span className="nx-legal-draft-tree-toggle-spacer" />
              )}
              <button
                type="button"
                data-tree-node-id={node.id}
                className={node.id === selectedId ? 'nx-legal-draft-tree-item is-selected' : 'nx-legal-draft-tree-item'}
                onClick={() => onSelect(node.id)}
              >
                {node.kind_label ? <span>{node.kind_label} </span> : null}
                <LegalIdentifierText value={node.display_identifier} />
                {node.printed_marker && node.printed_marker !== node.display_identifier ? (
                  <span> {node.printed_marker}</span>
                ) : null}
                {node.title ? <span> {node.title}</span> : null}
                {node.manually_added ? <span className="nx-legal-draft-manual-inline"> נוסף ידנית</span> : null}
                <span className={`nx-legal-draft-status is-${node.review_state}`}> {node.review_state_label}</span>
                {node.structure_completeness_confirmed ? (
                  <span className="nx-legal-draft-completeness-inline"> structure complete</span>
                ) : null}
              </button>
            </div>
            {expanded && hasChildren ? (
              <DraftTree
                nodes={node.children}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
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
