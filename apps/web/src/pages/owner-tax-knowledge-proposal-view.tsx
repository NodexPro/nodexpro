import type {
  OwnerTaxKnowledgeProposalOwnerView,
  OwnerTaxKnowledgeProposalOwnerViewItem,
  OwnerTaxKnowledgeProposalSlice,
  UnknownRecord,
} from './owner-legal-control-types';
import { emptyTaxKnowledgeProposalSlice } from './owner-legal-control-types';

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

function parseOwnerView(raw: UnknownRecord | null, fallback: OwnerTaxKnowledgeProposalOwnerView): OwnerTaxKnowledgeProposalOwnerView {
  if (!raw) return fallback;
  return {
    available: raw.available === true,
    heading: asString(raw.heading) || fallback.heading,
    question: asString(raw.question) || fallback.question,
    empty_title: asString(raw.empty_title) || fallback.empty_title,
    empty_detail: asString(raw.empty_detail) || fallback.empty_detail,
    status_label: asString(raw.status_label),
    revision_label: asString(raw.revision_label),
    understanding_summary: asString(raw.understanding_summary),
    publication_eligible_label: asString(raw.publication_eligible_label),
    owner_approval_allowed_label: asString(raw.owner_approval_allowed_label),
    rules: Array.isArray(raw.rules)
      ? raw.rules
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({
            title: asString(row.title),
            statement: asString(row.statement),
            applicability_status_label: asString(row.applicability_status_label),
            applies_if: asNullableString(row.applies_if),
            does_not_apply_if: asNullableString(row.does_not_apply_if),
            notes: asNullableString(row.notes),
          }))
      : [],
    facts_title: asString(raw.facts_title) || fallback.facts_title,
    facts_empty_label: asString(raw.facts_empty_label) || fallback.facts_empty_label,
    facts: parseItems(raw.facts),
    legal_values_title: asString(raw.legal_values_title) || fallback.legal_values_title,
    legal_values_empty_label: asString(raw.legal_values_empty_label) || fallback.legal_values_empty_label,
    legal_values: parseItems(raw.legal_values),
    relationships_title: asString(raw.relationships_title) || fallback.relationships_title,
    relationships_empty_label: asString(raw.relationships_empty_label) || fallback.relationships_empty_label,
    relationships: parseItems(raw.relationships),
    calculations_title: asString(raw.calculations_title) || fallback.calculations_title,
    calculations_empty_label: asString(raw.calculations_empty_label) || fallback.calculations_empty_label,
    calculations: parseItems(raw.calculations),
    evidence_title: asString(raw.evidence_title) || fallback.evidence_title,
    evidence_empty_label: asString(raw.evidence_empty_label) || fallback.evidence_empty_label,
    evidence_locator: asNullableString(raw.evidence_locator),
    evidence_quotes: parseItems(raw.evidence_quotes),
    evidence_citations: parseItems(raw.evidence_citations),
    uncertainties_title: asString(raw.uncertainties_title) || fallback.uncertainties_title,
    uncertainties_empty_label: asString(raw.uncertainties_empty_label) || fallback.uncertainties_empty_label,
    uncertainties: parseItems(raw.uncertainties),
    technical_title: asString(raw.technical_title) || fallback.technical_title,
    technical_rows: Array.isArray(raw.technical_rows)
      ? raw.technical_rows
          .map((row) => asRecord(row))
          .filter((row): row is UnknownRecord => row !== null)
          .map((row) => ({ label: asString(row.label), value: asString(row.value) }))
          .filter((row) => row.label || row.value)
      : [],
  };
}

function parseProposalMeta(raw: unknown): { id: string; revision_no: number; status_label: string } | null {
  const row = asRecord(raw);
  if (!row?.id) return null;
  return {
    id: asString(row.id),
    revision_no: Number(row.revision_no) || 0,
    status_label: asString(row.status_label),
  };
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

function ItemList({
  title,
  emptyLabel,
  items,
}: {
  title: string;
  emptyLabel: string;
  items: OwnerTaxKnowledgeProposalOwnerViewItem[];
}) {
  return (
    <div className="nx-legal-draft-ai-proposal-block">
      <div style={{ fontWeight: 600 }}>{title}</div>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <span>{item.label}</span>
              {item.detail ? (
                <div dir="auto" style={{ color: '#4b5563', fontSize: 13 }}>
                  {item.detail}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="nx-legal-draft-ai-proposal-empty">{emptyLabel}</div>
      )}
    </div>
  );
}

export function OwnerTaxKnowledgeProposalView({
  proposals,
}: {
  proposals: OwnerTaxKnowledgeProposalSlice;
}) {
  const view = proposals.owner_view;
  return (
    <section className="nx-legal-draft-ai-proposal">
      <div style={{ fontWeight: 600 }}>{view.heading}</div>
      <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{view.question}</p>
      {!view.available ? (
        <div className="nx-legal-draft-ai-proposal-empty">
          <div>{view.empty_title}</div>
          {view.empty_detail ? <div>{view.empty_detail}</div> : null}
        </div>
      ) : (
        <>
          <div className="nx-legal-draft-ai-proposal-meta">
            <span>{view.status_label}</span>
            <span>{view.revision_label}</span>
          </div>
          {view.understanding_summary ? (
            <div className="nx-legal-draft-ai-proposal-summary" dir="auto">
              {view.understanding_summary}
            </div>
          ) : null}
          {view.rules.map((rule, index) => (
            <div key={`${rule.title}-${index}`} className="nx-legal-draft-ai-proposal-block">
              {rule.title ? <div style={{ fontWeight: 600 }} dir="auto">{rule.title}</div> : null}
              {rule.statement ? (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }} dir="auto">
                  {rule.statement}
                </p>
              ) : null}
              {rule.applicability_status_label ? (
                <div style={{ fontSize: 13 }}>Applicability: {rule.applicability_status_label}</div>
              ) : null}
              {rule.applies_if ? (
                <div style={{ fontSize: 13 }}>
                  Conditions / applies if: <span dir="ltr">{rule.applies_if}</span>
                </div>
              ) : null}
              {rule.does_not_apply_if ? (
                <div style={{ fontSize: 13 }}>
                  Exclusions / does not apply if: <span dir="ltr">{rule.does_not_apply_if}</span>
                </div>
              ) : null}
              {rule.notes ? (
                <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }} dir="auto">
                  {rule.notes}
                </p>
              ) : null}
            </div>
          ))}
          <ItemList title={view.facts_title} emptyLabel={view.facts_empty_label} items={view.facts} />
          <ItemList title={view.legal_values_title} emptyLabel={view.legal_values_empty_label} items={view.legal_values} />
          <ItemList title={view.relationships_title} emptyLabel={view.relationships_empty_label} items={view.relationships} />
          <ItemList title={view.calculations_title} emptyLabel={view.calculations_empty_label} items={view.calculations} />
          <div className="nx-legal-draft-ai-proposal-block">
            <div style={{ fontWeight: 600 }}>{view.evidence_title}</div>
            {view.evidence_locator ? <div style={{ fontSize: 13 }}>Locator: {view.evidence_locator}</div> : null}
            {view.evidence_quotes.length || view.evidence_citations.length ? (
              <>
                {view.evidence_quotes.map((quote, index) => (
                  <div key={`${quote.label}-${index}`}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{quote.label}</div>
                    {quote.detail ? (
                      <pre className="nx-legal-draft-readonly" dir="auto">
                        {quote.detail}
                      </pre>
                    ) : null}
                  </div>
                ))}
                {view.evidence_citations.map((citation, index) => (
                  <div key={`${citation.label}-${index}`} style={{ fontSize: 13 }}>
                    {citation.label}
                  </div>
                ))}
              </>
            ) : (
              <div className="nx-legal-draft-ai-proposal-empty">{view.evidence_empty_label}</div>
            )}
          </div>
          <ItemList
            title={view.uncertainties_title}
            emptyLabel={view.uncertainties_empty_label}
            items={view.uncertainties}
          />
          <div style={{ fontSize: 13 }}>Publication eligible: {view.publication_eligible_label}</div>
          <div style={{ fontSize: 13 }}>Owner approval allowed: {view.owner_approval_allowed_label}</div>
          {view.technical_rows.length ? (
            <details className="nx-legal-draft-advanced">
              <summary>{view.technical_title}</summary>
              {view.technical_rows.map((row) => (
                <div key={row.label} style={{ fontSize: 12, color: '#4b5563' }}>
                  {row.label}: {row.value}
                </div>
              ))}
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
