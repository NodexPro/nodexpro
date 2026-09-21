import { useMemo, useState } from 'react';
import { userFacingApiMessage } from '../api/client';
import { SectionCard } from '../templates/template-1/components/SectionCard';
import type {
  OwnerRegulationRegistryCategory,
  OwnerRegulationRegistryEntry,
  TaxKnowledgeAggregate,
  UnknownRecord,
} from './owner-legal-control-types';
import '../styles/nx-modal.css';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  const [year, month, rest] = day.split('-');
  return `${rest}.${month}.${year}`;
}

function statusIcon(code: string): string {
  if (code === 'resolved') return '●';
  if (code === 'reviewed') return '✓';
  if (code === 'source_added') return '◐';
  return '○';
}

export function OwnerRegulationsRegistryPanel({
  taxKnowledge,
  busy,
  onCommand,
  onOpenTrainer,
}: {
  taxKnowledge: TaxKnowledgeAggregate;
  busy: boolean;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
  onOpenTrainer: (sourceId: string, upload: boolean) => void;
}) {
  const registry = taxKnowledge.regulations_orders_registry;
  const countryCode = taxKnowledge.selected_country_code ?? registry.selected_country_code;
  const [categoryTitle, setCategoryTitle] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [ownerRef, setOwnerRef] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing' | 'needs_review' | 'reviewed'>('all');
  const [nameEdits, setNameEdits] = useState<Record<string, { name: string; year: string }>>({});
  const [error, setError] = useState('');

  const categories = registry.categories;
  const activeCategory = useMemo(
    () => categories.find((row) => row.id === selectedCategoryId) ?? categories[0] ?? null,
    [categories, selectedCategoryId],
  );

  const visibleEntries = useMemo(() => {
    const rows = activeCategory?.entries ?? [];
    if (filter === 'missing') return rows.filter((row) => row.status_code === 'missing');
    if (filter === 'needs_review') return rows.filter((row) => row.status_code === 'source_added');
    if (filter === 'reviewed') return rows.filter((row) => row.status_code === 'reviewed' || row.status_code === 'resolved');
    return rows;
  }, [activeCategory, filter]);

  async function run(command: string, payload: UnknownRecord): Promise<void> {
    setError('');
    try {
      await onCommand(command, payload);
    } catch (err) {
      setError(userFacingApiMessage(err));
    }
  }

  async function openEntry(entry: OwnerRegulationRegistryEntry): Promise<void> {
    const command = entry.open_command;
    if (command.action_key === 'select_legal_training_document') {
      await run(command.action_key, command.payload);
      onOpenTrainer(entry.tax_source_id, false);
      return;
    }
    onOpenTrainer(entry.tax_source_id, true);
  }

  if (!countryCode) {
    return (
      <div className="nx-reg-registry" dir="ltr">
        <SectionCard>
          <h2>{registry.labels.title || 'Regulations & Orders'}</h2>
          <p>Select a country to manage Regulations and Orders.</p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="nx-reg-registry" dir="ltr">
      <SectionCard>
        <h2>{registry.labels.title || 'Regulations & Orders'}</h2>
        <p className="nx-reg-registry__intro">
          Owner catalog of Regulations and Orders. The number is the Owner book number, not a database identity.
          Groups reuse existing tax domains.
        </p>
        {error ? <p style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p> : null}
        <div className="nx-reg-registry__toolbar">
          <label className="nx-field">
            <span className="nx-field-label">New tax domain</span>
            <input
              className="nx-input nx-reg-owner-text"
              dir="auto"
              value={categoryTitle}
              onChange={(event) => setCategoryTitle(event.target.value)}
              disabled={busy}
              placeholder="Name as entered by Owner"
            />
          </label>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || !categoryTitle.trim()}
            onClick={() =>
              void run('create_tax_domain', {
                country_code: countryCode,
                title: categoryTitle.trim(),
                status: 'draft',
              }).then(() => setCategoryTitle(''))
            }
          >
            Add tax domain
          </button>
        </div>
        <p className="nx-reg-registry__hint">
          This creates a real tax domain. It is not a cosmetic regulation folder.
        </p>
      </SectionCard>

      {categories.map((category) => (
        <CategoryBlock
          key={category.id}
          category={category}
          labels={registry.labels}
          active={activeCategory?.id === category.id}
          filter={activeCategory?.id === category.id ? filter : 'all'}
          entries={activeCategory?.id === category.id ? visibleEntries : category.entries}
          busy={busy}
          nameEdits={nameEdits}
          ownerRef={activeCategory?.id === category.id ? ownerRef : ''}
          onSelect={() => {
            setSelectedCategoryId(category.id);
            setFilter('all');
          }}
          onFilter={setFilter}
          onOwnerRef={setOwnerRef}
          onNameEdit={(id, next) => setNameEdits((current) => ({ ...current, [id]: next }))}
          onAddEntry={() =>
            void run('ensure_regulation_registry_entry', {
              country_code: countryCode,
              tax_domain_id: category.id,
              owner_catalog_number: ownerRef.trim(),
            }).then(() => setOwnerRef(''))
          }
          onSaveMeta={(entry) => {
            const edit = nameEdits[entry.id] ?? { name: entry.name ?? '', year: entry.year == null ? '' : String(entry.year) };
            const payload: UnknownRecord = { tax_source_id: entry.tax_source_id };
            if (edit.name.trim()) payload.title = edit.name.trim();
            if (edit.year.trim()) payload.owner_catalog_year = Number(edit.year);
            void run('update_tax_source_metadata', payload);
          }}
          onOpen={openEntry}
        />
      ))}
    </div>
  );
}

function CategoryBlock({
  category,
  labels,
  active,
  filter,
  entries,
  busy,
  nameEdits,
  ownerRef,
  onSelect,
  onFilter,
  onOwnerRef,
  onNameEdit,
  onAddEntry,
  onSaveMeta,
  onOpen,
}: {
  category: OwnerRegulationRegistryCategory;
  labels: TaxKnowledgeAggregate['regulations_orders_registry']['labels'];
  active: boolean;
  filter: 'all' | 'missing' | 'needs_review' | 'reviewed';
  entries: OwnerRegulationRegistryEntry[];
  busy: boolean;
  nameEdits: Record<string, { name: string; year: string }>;
  ownerRef: string;
  onSelect: () => void;
  onFilter: (value: 'all' | 'missing' | 'needs_review' | 'reviewed') => void;
  onOwnerRef: (value: string) => void;
  onNameEdit: (id: string, next: { name: string; year: string }) => void;
  onAddEntry: () => void;
  onSaveMeta: (entry: OwnerRegulationRegistryEntry) => void;
  onOpen: (entry: OwnerRegulationRegistryEntry) => void;
}) {
  return (
    <SectionCard>
      <h3 dir="auto" className="nx-reg-owner-text">
        {category.title}
      </h3>
      <div className="nx-reg-counts" onClick={onSelect}>
        <button type="button" className={`nx-btn nx-btn-taxes-compact${filter === 'all' && active ? ' is-active' : ''}`} onClick={() => onFilter('all')}>
          All: {category.counts.all}
        </button>
        <button type="button" className={`nx-btn nx-btn-taxes-compact${filter === 'missing' && active ? ' is-active' : ''}`} onClick={() => onFilter('missing')}>
          Missing: {category.counts.missing}
        </button>
        <button type="button" className={`nx-btn nx-btn-taxes-compact${filter === 'needs_review' && active ? ' is-active' : ''}`} onClick={() => onFilter('needs_review')}>
          Needs review: {category.counts.needs_review}
        </button>
        <button type="button" className={`nx-btn nx-btn-taxes-compact${filter === 'reviewed' && active ? ' is-active' : ''}`} onClick={() => onFilter('reviewed')}>
          Reviewed: {category.counts.reviewed}
        </button>
      </div>
      <div className="nx-reg-registry__toolbar">
        <label className="nx-field">
          <span className="nx-field-label">Owner number</span>
          <input className="nx-input" value={ownerRef} onChange={(event) => onOwnerRef(event.target.value)} disabled={busy} />
        </label>
        <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || !ownerRef.trim()} onClick={onAddEntry}>
          Add placeholder
        </button>
      </div>
      <table className="nx-reg-registry-table" dir="ltr">
        <thead>
          <tr>
            <th>No.</th>
            <th>Name</th>
            <th>Year</th>
            <th>Status</th>
            <th>{labels.effective}</th>
            <th>{labels.last_owner_review}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const edit = nameEdits[entry.id] ?? {
              name: entry.name ?? '',
              year: entry.year == null ? '' : String(entry.year),
            };
            return (
              <tr key={entry.id}>
                <td>
                  <button type="button" className="nx-reg-link" disabled={busy} onClick={() => onOpen(entry)}>
                    {entry.owner_catalog_number}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="nx-reg-link nx-reg-owner-text"
                    dir="auto"
                    disabled={busy}
                    onClick={() => onOpen(entry)}
                  >
                    {entry.name || '—'}
                  </button>
                  <input
                    className="nx-input nx-reg-owner-text"
                    dir="auto"
                    value={edit.name}
                    placeholder="Official name"
                    onChange={(event) => onNameEdit(entry.id, { ...edit, name: event.target.value })}
                    disabled={busy}
                  />
                </td>
                <td>
                  <input
                    className="nx-input"
                    value={edit.year}
                    placeholder="Year"
                    onChange={(event) => onNameEdit(entry.id, { ...edit, year: event.target.value })}
                    disabled={busy}
                  />
                </td>
                <td>
                  <span className={`nx-reg-status is-${entry.status_code}`}>
                    {statusIcon(entry.status_code)} {entry.status_label}
                  </span>
                </td>
                <td>{formatDate(entry.effective_from)}</td>
                <td>{formatDate(entry.last_owner_review_at)}</td>
                <td>
                  <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => onSaveMeta(entry)}>
                    Save
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SectionCard>
  );
}
