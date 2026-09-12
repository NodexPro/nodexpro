import { useMemo, useState, type FormEvent } from 'react';
import { userFacingApiMessage } from '../api/client';
import { EmptyState } from '../templates/template-1/components/EmptyState';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import type { TaxKnowledgeAggregate, UnknownRecord } from './owner-legal-control-types';
import '../styles/nx-modal.css';

type WorkspaceAction = { action_key?: string; enabled?: boolean; button_label?: string };
type CatalogOption = { value?: string; label?: string };
type PickerOption = {
  tax_rule_version_id?: string;
  label?: string;
  domain_id?: string | null;
  source_id?: string | null;
};
type WorkspaceCard = {
  id?: string;
  country_code?: string;
  country_name?: string;
  title?: string;
  current_value_display?: string;
  upcoming_value_display?: string | null;
  effective_display?: string;
  legal_basis_display?: string[];
  status_label?: string;
  filter_domain_ids?: string[];
  filter_source_ids?: string[];
  filter_status?: string;
  filter_effective_years?: string[];
  allowed_actions?: WorkspaceAction[];
  technical?: Record<string, string>;
  versions?: Array<{
    id?: string;
    status?: string;
    status_label?: string;
    effective_from?: string;
    effective_to?: string | null;
    value_display?: string;
    legal_basis_display?: string[];
    is_current?: boolean;
    is_upcoming?: boolean;
  }>;
};

type LegalValuesWorkspace = {
  schema_applied?: boolean;
  selected_country_code?: string | null;
  empty_state?: { title?: string; description?: string };
  cards?: WorkspaceCard[];
  picker_options?: PickerOption[];
  catalog?: { value_types?: CatalogOption[]; categories?: CatalogOption[] };
  allowed_actions?: WorkspaceAction[];
  filter_options?: {
    domains?: Array<{ id?: string; label?: string }>;
    sources?: Array<{ id?: string; label?: string; domain_id?: string }>;
    statuses?: Array<{ value?: string; label?: string }>;
  };
  warnings?: string[];
};

function enabledAction(actions: WorkspaceAction[] | undefined, key: string): WorkspaceAction | null {
  const found = (actions ?? []).find((action) => action.action_key === key);
  return found && found.enabled === true ? found : null;
}

function TechnicalDetails({ rows }: { rows: Array<[string, string]> }) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Technical details</summary>
      <div style={{ display: 'grid', gap: 2, marginTop: 6, fontSize: 12, color: '#4b5563' }}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <span style={{ color: '#9ca3af' }}>{label}: </span>
            <span style={{ wordBreak: 'break-all' }}>{value || '—'}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function OwnerLegalValuesPanel({
  workspace,
  taxKnowledge,
  busy,
  onSelectCountry,
  onCommand,
}: {
  workspace: LegalValuesWorkspace | UnknownRecord | null;
  taxKnowledge: TaxKnowledgeAggregate;
  busy: boolean;
  onSelectCountry: (countryCode: string) => void;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const model = (workspace ?? {}) as LegalValuesWorkspace;
  const selectedCountry = model.selected_country_code ?? taxKnowledge.selected_country_code;
  const selectedCountryName =
    taxKnowledge.countries.find((country) => country.code === selectedCountry)?.name || selectedCountry;
  const cards = model.cards ?? [];
  const author = enabledAction(model.allowed_actions, 'author_country_legal_value');
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'author' | 'version' | 'edit' | null>(null);
  const [target, setTarget] = useState<WorkspaceCard | null>(null);
  const [formError, setFormError] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [valueType, setValueType] = useState('money');
  const [initialValue, setInitialValue] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [ownerNote, setOwnerNote] = useState('');
  const [basisVersionId, setBasisVersionId] = useState('');

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (q && !String(card.title ?? '').toLowerCase().includes(q) && !String(card.current_value_display ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (domainFilter && !(card.filter_domain_ids ?? []).includes(domainFilter)) return false;
      if (sourceFilter && !(card.filter_source_ids ?? []).includes(sourceFilter)) return false;
      if (statusFilter && card.filter_status !== statusFilter) return false;
      if (yearFilter && !(card.filter_effective_years ?? []).includes(yearFilter)) return false;
      return true;
    });
  }, [cards, domainFilter, search, sourceFilter, statusFilter, yearFilter]);

  const years = [...new Set(cards.flatMap((card) => card.filter_effective_years ?? []))].sort();

  const openAuthor = () => {
    setDialog('author');
    setTarget(null);
    setFormError('');
    setLabel('');
    setCategory(String(model.catalog?.categories?.[0]?.value ?? 'Income Tax'));
    setValueType(String(model.catalog?.value_types?.find((item) => item.value === 'money')?.value ?? 'money'));
    setInitialValue('');
    setEffectiveFrom('');
    setEffectiveTo('');
    setOwnerNote('');
    setBasisVersionId(String(model.picker_options?.[0]?.tax_rule_version_id ?? ''));
  };

  const openVersion = (card: WorkspaceCard) => {
    setDialog('version');
    setTarget(card);
    setFormError('');
    setInitialValue('');
    setEffectiveFrom('');
    setEffectiveTo('');
    setBasisVersionId(String(model.picker_options?.[0]?.tax_rule_version_id ?? ''));
  };

  const openEdit = (card: WorkspaceCard) => {
    setDialog('edit');
    setTarget(card);
    setFormError('');
    setLabel(String(card.title ?? ''));
    setOwnerNote(card.technical?.owner_note ?? '');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCountry) return;
    setFormError('');
    try {
      if (dialog === 'author') {
        await onCommand('author_country_legal_value', {
          country_code: selectedCountry,
          label,
          category,
          value_type: valueType,
          initial_value: valueType === 'boolean' ? initialValue === 'true' : initialValue,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          owner_note: ownerNote || null,
          tax_rule_version_ids: [basisVersionId],
        });
      } else if (dialog === 'version' && target) {
        const type = target.technical?.value_type ?? 'string';
        await onCommand('create_legal_value_version', {
          country_code: selectedCountry,
          value_key: target.technical?.value_key,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          value_payload_json: type === 'boolean' ? initialValue === 'true' : type === 'number' || type === 'percentage' || type === 'money' ? Number(initialValue) : initialValue,
          tax_rule_version_ids: [basisVersionId],
        });
      } else if (dialog === 'edit' && target) {
        await onCommand('update_legal_value_metadata', {
          country_code: selectedCountry,
          value_key: target.technical?.value_key,
          label,
          owner_note: ownerNote || null,
        });
      }
      setDialog(null);
    } catch (error) {
      setFormError(userFacingApiMessage(error));
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionCard>
        <h2 style={{ margin: 0, fontSize: 18 }}>Legal Values</h2>
        {!selectedCountry ? (
          <EmptyState title="Select a country" description="Choose a country to author its legal values." />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {selectedCountryName ? (
              <div dir="auto" style={{ fontSize: 16, fontWeight: 600 }}>
                {selectedCountryName}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(taxKnowledge.countries ?? []).map((country) => (
                <button
                  key={country.code}
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || country.code === selectedCountry}
                  onClick={() => onSelectCountry(country.code)}
                >
                  {country.name || country.code}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="nx-input"
                style={{ minWidth: 200 }}
              />
              <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}>
                <option value="">Domain</option>
                {(model.filter_options?.domains ?? []).map((domain) => (
                  <option key={String(domain.id)} value={String(domain.id)}>
                    {domain.label}
                  </option>
                ))}
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="">Source</option>
                {(model.filter_options?.sources ?? []).map((source) => (
                  <option key={String(source.id)} value={String(source.id)}>
                    {source.label}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">Status</option>
                {(model.filter_options?.statuses ?? []).map((status) => (
                  <option key={String(status.value)} value={String(status.value)}>
                    {status.label}
                  </option>
                ))}
              </select>
              <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                <option value="">Effective year</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              {author ? (
                <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={openAuthor}>
                  + Add Legal Value
                </button>
              ) : null}
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled title="Coming later">
                Upload material — Coming later
              </button>
            </div>
            {model.schema_applied === false ? (
              <EmptyState
                title="Legal Value authority schema not applied"
                description="Migration 623 is required on DEV before legal values can be pinned to Legal Library rule versions."
              />
            ) : !cards.length ? (
              <EmptyState
                title={model.empty_state?.title || 'No legal values yet.'}
                description={
                  model.empty_state?.description ||
                  'Add the first legal value after its legal basis exists in the Legal Library.'
                }
              />
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {visibleCards.map((card) => {
                  const edit = enabledAction(card.allowed_actions, 'update_legal_value_metadata');
                  const neu = enabledAction(card.allowed_actions, 'create_legal_value_version');
                  const activate = enabledAction(card.allowed_actions, 'activate_legal_value_version');
                  const draft = (card.versions ?? []).find((version) => version.status === 'draft');
                  return (
                    <div key={String(card.id)} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                      <div dir="auto" style={{ fontSize: 16, fontWeight: 700 }}>
                        {card.title}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 14 }}>
                        Current value: <strong>{card.current_value_display || '—'}</strong>
                      </div>
                      <div style={{ fontSize: 13, color: '#4b5563' }}>Effective: {card.effective_display}</div>
                      <div style={{ marginTop: 6, fontSize: 13 }}>
                        Legal basis:
                        {(card.legal_basis_display ?? []).length ? (
                          <div dir="auto">{(card.legal_basis_display ?? []).join(' · ')}</div>
                        ) : (
                          <div style={{ color: '#6b7280' }}>Not linked yet</div>
                        )}
                      </div>
                      <div style={{ fontSize: 13 }}>Status: {card.status_label}</div>
                      {card.upcoming_value_display ? (
                        <div style={{ fontSize: 13 }}>Upcoming value: {card.upcoming_value_display}</div>
                      ) : null}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        {edit ? (
                          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => openEdit(card)}>
                            Edit draft
                          </button>
                        ) : null}
                        {neu ? (
                          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => openVersion(card)}>
                            New version
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="nx-btn nx-btn-taxes-compact"
                          onClick={() => setHistoryId(historyId === card.id ? null : String(card.id))}
                        >
                          History
                        </button>
                        {activate && draft?.id ? (
                          <button
                            type="button"
                            className="nx-btn nx-btn-taxes-compact"
                            disabled={busy}
                            onClick={() =>
                              void onCommand('activate_legal_value_version', {
                                legal_value_version_id: draft.id,
                                country_code: card.country_code,
                              })
                            }
                          >
                            Activate
                          </button>
                        ) : null}
                      </div>
                      {historyId === card.id ? (
                        <div style={{ marginTop: 10, fontSize: 13 }}>
                          {(card.versions ?? []).map((version) => (
                            <div key={String(version.id)} style={{ padding: '4px 0', borderTop: '1px solid #f3f4f6' }}>
                              {version.status_label}: {version.value_display} · {version.effective_from} – {version.effective_to || 'open'}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <TechnicalDetails
                        rows={[
                          ['id', card.technical?.id ?? ''],
                          ['value_key', card.technical?.value_key ?? ''],
                          ['category', card.technical?.category ?? ''],
                          ['module_scope', card.technical?.module_scope ?? ''],
                          ['value_type', card.technical?.value_type ?? ''],
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {dialog ? (
        <div className="nx-modal-backdrop" role="presentation">
          <form className="nx-modal nx-accounting-editor-modal" onSubmit={(event) => void submit(event)}>
            <div className="nx-modal-header">
              <h3 style={{ margin: 0 }}>
                {dialog === 'author' ? 'Add Legal Value' : dialog === 'version' ? 'New version' : 'Edit draft'}
              </h3>
            </div>
            <div className="nx-modal-body" style={{ display: 'grid', gap: 10 }}>
              {formError ? <div className="nx-form-error">{formError}</div> : null}
              {dialog !== 'version' ? (
                <label>
                  Name
                  <input value={label} onChange={(event) => setLabel(event.target.value)} required />
                </label>
              ) : null}
              {dialog === 'author' ? (
                <>
                  <label>
                    Type
                    <select value={valueType} onChange={(event) => setValueType(event.target.value)}>
                      {(model.catalog?.value_types ?? []).map((item) => (
                        <option key={String(item.value)} value={String(item.value)}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select value={category} onChange={(event) => setCategory(event.target.value)}>
                      {(model.catalog?.categories ?? []).map((item) => (
                        <option key={String(item.value)} value={String(item.value)}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {dialog !== 'edit' ? (
                <>
                  <label>
                    Initial value
                    <input value={initialValue} onChange={(event) => setInitialValue(event.target.value)} required />
                  </label>
                  <label>
                    Effective from
                    <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required />
                  </label>
                  <label>
                    Effective to
                    <input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} />
                  </label>
                  <label>
                    Legal basis
                    <select value={basisVersionId} onChange={(event) => setBasisVersionId(event.target.value)} required>
                      <option value="">Select from Legal Library</option>
                      {(model.picker_options ?? []).map((option) => (
                        <option key={String(option.tax_rule_version_id)} value={String(option.tax_rule_version_id)}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {dialog !== 'version' ? (
                <label>
                  Owner note
                  <textarea value={ownerNote} onChange={(event) => setOwnerNote(event.target.value)} />
                </label>
              ) : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => setDialog(null)}>
                Close
              </button>
              <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
