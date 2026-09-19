import { useEffect, useRef, useState } from 'react';
import type {
  OwnerTaxKnowledgeProposalAction,
  OwnerTaxKnowledgeProposalApproveAction,
  OwnerTaxKnowledgeProposalCorrectAction,
  OwnerTaxKnowledgeProposalCorrectRule,
  OwnerTaxKnowledgeProposalCreateAction,
  OwnerTaxKnowledgeProposalLocaleView,
  OwnerTaxKnowledgeProposalMeta,
  OwnerTaxKnowledgeProposalOwnerLocale,
  OwnerTaxKnowledgeProposalOwnerView,
  OwnerTaxKnowledgeProposalOwnerViewItem,
  OwnerTaxKnowledgeProposalOwnerViewRule,
  OwnerTaxKnowledgeProposalSlice,
  UnknownRecord,
} from './owner-legal-control-types';
import { emptyTaxKnowledgeProposalSlice } from './owner-legal-control-types';

export const PUBLISH_TAX_KNOWLEDGE_PROPOSAL_TO_CANONICAL_DRAFT =
  'publish_tax_knowledge_proposal_to_canonical_draft' as const;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function parseItems(raw: unknown): OwnerTaxKnowledgeProposalOwnerViewItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      label: asString(row.label),
      detail: asNullableString(row.detail),
    }))
    .filter((row) => row.label || row.detail);
}

function parseLocaleCode(value: unknown): OwnerTaxKnowledgeProposalOwnerLocale {
  return value === 'ru' || value === 'en' || value === 'he' ? value : 'he';
}

function parseLocaleView(raw: UnknownRecord | null, fallback: OwnerTaxKnowledgeProposalLocaleView): OwnerTaxKnowledgeProposalLocaleView {
  if (!raw) return fallback;
  return {
    dir: raw.dir === 'ltr' || raw.dir === 'rtl' ? raw.dir : fallback.dir,
    question: asString(raw.question) || fallback.question,
    empty_title: asString(raw.empty_title) || fallback.empty_title,
    empty_detail: asString(raw.empty_detail) || fallback.empty_detail,
    create_label: asString(raw.create_label) || fallback.create_label,
    create_disabled_reason: asString(raw.create_disabled_reason) || fallback.create_disabled_reason,
    analyzing_label: asString(raw.analyzing_label) || fallback.analyzing_label,
    generation_failed: asString(raw.generation_failed) || fallback.generation_failed,
    explanation: asString(raw.explanation),
    applicability: asString(raw.applicability),
    uncertainty: asNullableString(raw.uncertainty),
    warning_tone: raw.warning_tone === 'blocking' || raw.warning_tone === 'review' ? raw.warning_tone : null,
    citation_label: asString(raw.citation_label) || fallback.citation_label,
    details_label: asString(raw.details_label) || fallback.details_label,
    approve_aria_label: asString(raw.approve_aria_label) || fallback.approve_aria_label,
    publish_aria_label: asString(raw.publish_aria_label) || fallback.publish_aria_label,
    published_to_draft_label: asString(raw.published_to_draft_label) || fallback.published_to_draft_label,
    correct_label: asString(raw.correct_label) || fallback.correct_label,
    correct_save_label: asString(raw.correct_save_label) || fallback.correct_save_label,
    correct_title_label: asString(raw.correct_title_label) || fallback.correct_title_label,
    correct_statement_label: asString(raw.correct_statement_label) || fallback.correct_statement_label,
    correct_notes_label: asString(raw.correct_notes_label) || fallback.correct_notes_label,
  };
}

function parseRules(raw: unknown): OwnerTaxKnowledgeProposalOwnerViewRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      title: asString(row.title),
      statement: asString(row.statement),
      applicability_status: asString(row.applicability_status),
      applies_if: asNullableString(row.applies_if),
      does_not_apply_if: asNullableString(row.does_not_apply_if),
      notes: asNullableString(row.notes),
    }));
}

function parseCreateAction(raw: UnknownRecord | null, fallback: OwnerTaxKnowledgeProposalCreateAction): OwnerTaxKnowledgeProposalCreateAction {
  if (!raw) return fallback;
  return {
    action_key: 'generate_tax_knowledge_proposal',
    visible: raw.visible === true,
    enabled: raw.enabled === true,
    legal_text_draft_id: asNullableString(raw.legal_text_draft_id),
  };
}

function parseApproveAction(
  raw: UnknownRecord | null,
  fallback: OwnerTaxKnowledgeProposalApproveAction,
): OwnerTaxKnowledgeProposalApproveAction {
  if (!raw) return fallback;
  return {
    action_key: 'set_tax_knowledge_proposal_review_status',
    visible: raw.visible === true,
    enabled: raw.enabled === true,
    tax_knowledge_proposal_id: asNullableString(raw.tax_knowledge_proposal_id),
    status: 'owner_approved',
  };
}

function parseCorrectRules(raw: unknown): OwnerTaxKnowledgeProposalCorrectRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      proposal_rule_key: asString(row.proposal_rule_key),
      title: asString(row.title),
      statement: asString(row.statement),
      notes: asString(row.notes),
    }))
    .filter((row) => row.proposal_rule_key);
}

function parseCorrectAction(
  raw: UnknownRecord | null,
  fallback: OwnerTaxKnowledgeProposalCorrectAction,
): OwnerTaxKnowledgeProposalCorrectAction {
  if (!raw) return fallback;
  return {
    action_key: 'create_corrected_tax_knowledge_proposal',
    visible: raw.visible === true,
    enabled: raw.enabled === true,
    source_tax_knowledge_proposal_id: asNullableString(raw.source_tax_knowledge_proposal_id),
    rules: parseCorrectRules(raw.rules),
  };
}

function parseOwnerView(raw: UnknownRecord | null, fallback: OwnerTaxKnowledgeProposalOwnerView): OwnerTaxKnowledgeProposalOwnerView {
  if (!raw) return fallback;
  const byRaw = asRecord(raw.by_locale);
  const detailsRaw = asRecord(raw.details);
  const sourceRaw = asRecord(raw.source);
  return {
    available: raw.available === true,
    has_proposal: raw.has_proposal === true,
    default_locale: parseLocaleCode(raw.default_locale),
    locale_options: Array.isArray(raw.locale_options)
      ? raw.locale_options
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({ code: parseLocaleCode(row.code), label: asString(row.label) }))
          .filter((row) => row.label)
      : fallback.locale_options,
    source: {
      identifier: asNullableString(sourceRaw?.identifier),
      quote: asNullableString(sourceRaw?.quote),
    },
    create: parseCreateAction(asRecord(raw.create), fallback.create),
    approve: parseApproveAction(asRecord(raw.approve), fallback.approve),
    correct: parseCorrectAction(asRecord(raw.correct), fallback.correct),
    by_locale: {
      he: parseLocaleView(asRecord(byRaw?.he), fallback.by_locale.he),
      ru: parseLocaleView(asRecord(byRaw?.ru), fallback.by_locale.ru),
      en: parseLocaleView(asRecord(byRaw?.en), fallback.by_locale.en),
    },
    details: {
      status_label: asString(detailsRaw?.status_label),
      revision_label: asString(detailsRaw?.revision_label),
      extraction_outcome: asNullableString(detailsRaw?.extraction_outcome),
      rules: parseRules(detailsRaw?.rules),
      facts: parseItems(detailsRaw?.facts),
      legal_values: parseItems(detailsRaw?.legal_values),
      relationships: parseItems(detailsRaw?.relationships),
      calculations: parseItems(detailsRaw?.calculations),
      publication_eligible: asString(detailsRaw?.publication_eligible),
      owner_approval_allowed: asString(detailsRaw?.owner_approval_allowed),
      technical_rows: Array.isArray(detailsRaw?.technical_rows)
        ? detailsRaw.technical_rows
            .map((row) => asRecord(row))
            .filter((row): row is UnknownRecord => row !== null)
            .map((row) => ({ label: asString(row.label), value: asString(row.value) }))
            .filter((row) => row.label || row.value)
        : [],
    },
  };
}

function parseProposalActions(raw: unknown): OwnerTaxKnowledgeProposalAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => asRecord(row))
    .filter((row): row is UnknownRecord => row !== null)
    .map((row) => ({
      action_key: asString(row.action_key),
      enabled: row.enabled === true,
    }))
    .filter((row) => row.action_key);
}

function parseProposalMeta(raw: unknown): OwnerTaxKnowledgeProposalMeta | null {
  const row = asRecord(raw);
  if (!row?.id) return null;
  return {
    id: asString(row.id),
    revision_no: Number(row.revision_no) || 0,
    status: asString(row.status),
    status_label: asString(row.status_label),
    allowed_actions: parseProposalActions(row.allowed_actions),
  };
}

export function publishActionFromProposalSlice(slice: OwnerTaxKnowledgeProposalSlice): {
  visible: boolean;
  action_key: typeof PUBLISH_TAX_KNOWLEDGE_PROPOSAL_TO_CANONICAL_DRAFT;
  tax_knowledge_proposal_id: string | null;
} {
  const action = (slice.selected?.allowed_actions ?? []).find(
    (row) => row.action_key === PUBLISH_TAX_KNOWLEDGE_PROPOSAL_TO_CANONICAL_DRAFT,
  );
  return {
    visible: action?.enabled === true,
    action_key: PUBLISH_TAX_KNOWLEDGE_PROPOSAL_TO_CANONICAL_DRAFT,
    tax_knowledge_proposal_id: slice.selected?.id ?? null,
  };
}

export function isPublishedToCanonicalDraft(slice: OwnerTaxKnowledgeProposalSlice): boolean {
  return slice.selected?.status === 'published_to_canonical_draft';
}

export function parseTaxKnowledgeProposalSlice(raw: unknown): OwnerTaxKnowledgeProposalSlice {
  const empty = emptyTaxKnowledgeProposalSlice();
  const rec = asRecord(raw);
  if (!rec) return empty;
  const history = Array.isArray(rec.history)
    ? rec.history.map(parseProposalMeta).filter((row): row is NonNullable<typeof row> => row !== null)
    : [];
  return {
    latest: parseProposalMeta(rec.latest),
    selected: parseProposalMeta(rec.selected),
    history,
    owner_view: parseOwnerView(asRecord(rec.owner_view), empty.owner_view),
  };
}

function DetailList({ title, items }: { title: string; items: OwnerTaxKnowledgeProposalOwnerViewItem[] }) {
  if (!items.length) return null;
  return (
    <div className="nx-legal-draft-ai-proposal-block">
      <div className="nx-legal-draft-ai-proposal-k">{title}</div>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <span>{item.label}</span>
            {item.detail ? <div dir="auto">{item.detail}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OwnerTaxKnowledgeProposalView({
  proposals,
  onCommand,
}: {
  proposals: OwnerTaxKnowledgeProposalSlice;
  onCommand?: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const view = proposals.owner_view;
  const [locale, setLocale] = useState<OwnerTaxKnowledgeProposalOwnerLocale>(view.default_locale || 'he');
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [ruleDrafts, setRuleDrafts] = useState(view.correct.rules);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const publish = publishActionFromProposalSlice(proposals);
  const publishedToDraft = isPublishedToCanonicalDraft(proposals);

  useEffect(() => {
    setLocale(view.default_locale || 'he');
  }, [view.default_locale, view.available, view.source.identifier, view.create.legal_text_draft_id]);

  useEffect(() => {
    setFailed(false);
    setCreating(false);
    setApproving(false);
    setPublishing(false);
    setCorrecting(false);
    setCorrectBusy(false);
    setRuleDrafts(view.correct.rules);
    inFlight.current = false;
  }, [view.has_proposal, view.create.legal_text_draft_id, view.approve.tax_knowledge_proposal_id, view.correct.source_tax_knowledge_proposal_id, proposals.selected?.id, proposals.selected?.status]);

  const selected = view.locale_options.some((row) => row.code === locale) ? locale : view.default_locale;
  const loc = view.by_locale[selected] ?? view.by_locale.he;
  const details = view.details;
  const createDisabled = !view.create.enabled || creating || inFlight.current || !onCommand;
  const approveDisabled = !view.approve.enabled || approving || publishing || creating || correctBusy || inFlight.current || !onCommand;
  const publishDisabled = !publish.visible || publishing || approving || creating || correctBusy || inFlight.current || !onCommand;
  const correctDisabled = !view.correct.enabled || correctBusy || approving || publishing || creating || inFlight.current || !onCommand;

  async function createProposal(): Promise<void> {
    if (inFlight.current || !view.create.enabled || !view.create.legal_text_draft_id || !onCommand) return;
    inFlight.current = true;
    setCreating(true);
    setFailed(false);
    try {
      await onCommand(view.create.action_key, { legal_text_draft_id: view.create.legal_text_draft_id });
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }

  async function approveProposal(): Promise<void> {
    if (inFlight.current || !view.approve.enabled || !view.approve.tax_knowledge_proposal_id || !onCommand) return;
    inFlight.current = true;
    setApproving(true);
    try {
      await onCommand(view.approve.action_key, {
        tax_knowledge_proposal_id: view.approve.tax_knowledge_proposal_id,
        status: view.approve.status,
      });
    } finally {
      inFlight.current = false;
      setApproving(false);
    }
  }

  async function publishProposal(): Promise<void> {
    if (inFlight.current || !publish.visible || !publish.tax_knowledge_proposal_id || !onCommand) return;
    inFlight.current = true;
    setPublishing(true);
    try {
      await onCommand(publish.action_key, {
        tax_knowledge_proposal_id: publish.tax_knowledge_proposal_id,
      });
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }

  async function saveCorrection(): Promise<void> {
    if (inFlight.current || !view.correct.enabled || !view.correct.source_tax_knowledge_proposal_id || !onCommand) return;
    inFlight.current = true;
    setCorrectBusy(true);
    try {
      await onCommand(view.correct.action_key, {
        source_tax_knowledge_proposal_id: view.correct.source_tax_knowledge_proposal_id,
        rule_text_corrections: ruleDrafts.map((row) => ({
          proposal_rule_key: row.proposal_rule_key,
          title: row.title,
          statement: row.statement,
          notes: row.notes,
        })),
      });
      setCorrecting(false);
    } finally {
      inFlight.current = false;
      setCorrectBusy(false);
    }
  }

  return (
    <section className="nx-legal-draft-ai-proposal" dir={loc.dir}>
      <div className="nx-legal-draft-ai-proposal-toolbar">
        <div className="nx-legal-draft-ai-proposal-langs" dir="ltr">
          {view.locale_options.map((option) => (
            <button
              key={option.code}
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              aria-pressed={selected === option.code}
              onClick={() => setLocale(option.code)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {view.create.visible ? (
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact nx-legal-draft-ai-proposal-create"
            disabled={createDisabled}
            onClick={() => void createProposal()}
          >
            {creating ? loc.analyzing_label : '✨ Proposal'}
          </button>
        ) : null}
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact nx-legal-draft-ai-proposal-approve"
          disabled={approveDisabled}
          aria-label={loc.approve_aria_label}
          title={loc.approve_aria_label}
          onClick={() => void approveProposal()}
        >
          ✓
        </button>
        {publish.visible ? (
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact nx-legal-draft-ai-proposal-publish"
            disabled={publishDisabled}
            aria-label={loc.publish_aria_label}
            title={loc.publish_aria_label}
            onClick={() => void publishProposal()}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                fill="currentColor"
                d="M8 1.6 4.8 4.8h2V9h2.4V4.8h2L8 1.6Zm-5 8.8v2.4h10V10.4H14v3.2H2V10.4h1Z"
              />
            </svg>
          </button>
        ) : null}
      </div>
      {publishedToDraft ? (
        <div className="nx-legal-draft-ai-proposal-published">{loc.published_to_draft_label}</div>
      ) : null}
      {view.create.visible && !view.create.enabled && !creating ? (
        <div className="nx-legal-draft-ai-proposal-gate">{loc.create_disabled_reason}</div>
      ) : null}
      {creating ? <div className="nx-legal-draft-ai-proposal-analyzing">{loc.analyzing_label}</div> : null}
      {failed && !view.has_proposal ? (
        <div className="nx-legal-draft-ai-proposal-error">{loc.generation_failed}</div>
      ) : null}
      {!view.available ? (
        <div className="nx-legal-draft-ai-proposal-empty">
          <div>{loc.empty_title}</div>
          {loc.empty_detail && !creating ? <div>{loc.empty_detail}</div> : null}
        </div>
      ) : (
        <>
          {view.source.identifier ? (
            <div className="nx-legal-draft-ai-proposal-id" dir="auto">
              {view.source.identifier}
            </div>
          ) : null}
          <div className="nx-legal-draft-ai-proposal-q">{loc.question}</div>
          {loc.explanation ? <div className="nx-legal-draft-ai-proposal-summary">{loc.explanation}</div> : null}
          {loc.applicability ? <div className="nx-legal-draft-ai-proposal-line">{loc.applicability}</div> : null}
          {view.correct.visible ? (
            <div className="nx-legal-draft-ai-proposal-correct">
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={correctDisabled && !correcting}
                onClick={() => {
                  setRuleDrafts(view.correct.rules);
                  setCorrecting((open) => !open);
                }}
              >
                {loc.correct_label}
              </button>
              {correcting ? (
                <div className="nx-legal-draft-ai-proposal-correct-form">
                  {ruleDrafts.map((row, index) => (
                    <div key={row.proposal_rule_key} className="nx-legal-draft-ai-proposal-block">
                      <label className="nx-legal-draft-ai-proposal-k">
                        {loc.correct_title_label}
                        <input
                          className="nx-legal-draft-ai-proposal-input"
                          value={row.title}
                          onChange={(event) => {
                            const title = event.target.value;
                            setRuleDrafts((current) =>
                              current.map((item, itemIndex) => (itemIndex === index ? { ...item, title } : item)),
                            );
                          }}
                        />
                      </label>
                      <label className="nx-legal-draft-ai-proposal-k">
                        {loc.correct_statement_label}
                        <textarea
                          className="nx-legal-draft-ai-proposal-input"
                          rows={3}
                          value={row.statement}
                          onChange={(event) => {
                            const statement = event.target.value;
                            setRuleDrafts((current) =>
                              current.map((item, itemIndex) => (itemIndex === index ? { ...item, statement } : item)),
                            );
                          }}
                        />
                      </label>
                      <label className="nx-legal-draft-ai-proposal-k">
                        {loc.correct_notes_label}
                        <textarea
                          className="nx-legal-draft-ai-proposal-input"
                          rows={2}
                          value={row.notes}
                          onChange={(event) => {
                            const notes = event.target.value;
                            setRuleDrafts((current) =>
                              current.map((item, itemIndex) => (itemIndex === index ? { ...item, notes } : item)),
                            );
                          }}
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={correctDisabled}
                    onClick={() => void saveCorrection()}
                  >
                    {loc.correct_save_label}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {loc.uncertainty ? (
            <div
              className={
                loc.warning_tone === 'blocking'
                  ? 'nx-legal-draft-ai-proposal-warn is-blocking'
                  : loc.warning_tone === 'review'
                    ? 'nx-legal-draft-ai-proposal-warn is-review'
                    : 'nx-legal-draft-ai-proposal-warn'
              }
            >
              {loc.uncertainty}
            </div>
          ) : null}
          {view.source.quote || view.source.identifier ? (
            <div className="nx-legal-draft-ai-proposal-cite">
              <div className="nx-legal-draft-ai-proposal-k">{loc.citation_label}</div>
              {view.source.quote ? (
                <pre className="nx-legal-draft-ai-proposal-quote" dir="auto">
                  {view.source.quote}
                </pre>
              ) : null}
            </div>
          ) : null}
          <details className="nx-legal-draft-ai-proposal-more">
            <summary>{loc.details_label}</summary>
            {details.status_label ? <div>{details.status_label}</div> : null}
            {details.revision_label ? <div>{details.revision_label}</div> : null}
            {details.extraction_outcome ? <div>extraction_outcome: {details.extraction_outcome}</div> : null}
            {details.rules.map((rule, index) => (
              <div key={`${rule.title}-${index}`} className="nx-legal-draft-ai-proposal-block">
                {rule.title ? <div dir="auto">{rule.title}</div> : null}
                {rule.statement ? <div dir="auto">{rule.statement}</div> : null}
                {rule.applicability_status ? <div>{rule.applicability_status}</div> : null}
                {rule.applies_if ? <div dir="ltr">applies_if: {rule.applies_if}</div> : null}
                {rule.does_not_apply_if ? <div dir="ltr">does_not_apply_if: {rule.does_not_apply_if}</div> : null}
                {rule.notes ? <div dir="auto">{rule.notes}</div> : null}
              </div>
            ))}
            <DetailList title="facts" items={details.facts} />
            <DetailList title="legal_values" items={details.legal_values} />
            <DetailList title="relationships" items={details.relationships} />
            <DetailList title="calculations" items={details.calculations} />
            {details.publication_eligible ? <div>publication_eligible: {details.publication_eligible}</div> : null}
            {details.owner_approval_allowed ? <div>owner_approval_allowed: {details.owner_approval_allowed}</div> : null}
            {details.technical_rows.map((row) => (
              <div key={row.label}>
                {row.label}: {row.value}
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
