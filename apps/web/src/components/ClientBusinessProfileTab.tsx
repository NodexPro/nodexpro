import { useEffect, useMemo, useState } from 'react';
import { apiJson, type ApiError } from '../api/client';
import { moduleClientOperationsAccountingCommands } from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import '../styles/nx-modal.css';

export type BusinessProfileSectionFieldKey =
  | 'business_domain'
  | 'business_activity_description'
  | 'business_address'
  | 'private_address'
  | 'business_operation_mode'
  | 'primary_customer_type'
  | 'is_seasonal_business'
  | 'peak_months'
  | 'business_open_date'
  | 'business_close_date';

export type BusinessProfileFieldType = 'text' | 'textarea' | 'enum_single' | 'boolean' | 'multi_enum' | 'date';

export type BusinessProfileOption = {
  value: string | number | boolean;
  label: string;
};

export type ClientBusinessProfileField = {
  key: BusinessProfileSectionFieldKey;
  label: string;
  type: BusinessProfileFieldType;
  value: string | boolean | number[] | null;
  options?: BusinessProfileOption[];
  required: boolean;
  editable: boolean;
  visible: boolean;
  max_length?: number;
  validation?: Array<{ rule_key: string; message_he: string }>;
  group_key: string;
  group_label: string;
  group_order: number;
  row_order: number;
};

export type ClientBusinessProfileSectionResponse = {
  section_key: 'business_profile';
  section_label: string;
  permissions: {
    can_view_business_profile: boolean;
    can_edit_business_profile: boolean;
  };
  version: number;
  fields: ClientBusinessProfileField[];
};

function asStringOrNull(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s ? s : null;
}

function asDateInputValue(v: string | null | undefined): string {
  return v ?? '';
}

function formatDisplayValue(f: ClientBusinessProfileField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (f.type === 'boolean') {
    const o = (f.options ?? []).find((x) => x.value === value);
    return o?.label ?? (value ? 'כן' : 'לא');
  }
  if (f.type === 'enum_single') {
    const o = (f.options ?? []).find((x) => String(x.value) === String(value));
    return o?.label ?? String(value);
  }
  if (f.type === 'multi_enum') {
    const arr = Array.isArray(value) ? (value as number[]) : [];
    if (!arr.length) return '—';
    return arr
      .map((n) => (f.options ?? []).find((o) => Number(o.value) === n)?.label ?? String(n))
      .join(', ');
  }
  if (f.type === 'date') return String(value);
  return String(value);
}

export function ClientBusinessProfileTab({
  clientId,
  section,
  onCaseUpdated,
}: {
  clientId: string;
  section: ClientBusinessProfileSectionResponse;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Record<BusinessProfileSectionFieldKey, unknown>>(() => {
    const init: Record<BusinessProfileSectionFieldKey, unknown> = {} as any;
    for (const f of section.fields) init[f.key] = f.value;
    return init;
  });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErrorHe, setSaveErrorHe] = useState('');
  const [saveSuccessHe, setSaveSuccessHe] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<BusinessProfileSectionFieldKey, string>>>(() => ({}));

  const canEdit = section.permissions.can_edit_business_profile;

  const fieldOrder = useMemo(() => {
    return section.fields.filter((f) => f.visible);
  }, [section.fields]);

  const resetFromSection = () => {
    const init: Record<BusinessProfileSectionFieldKey, unknown> = {} as any;
    for (const f of section.fields) init[f.key] = f.value;
    setDraft(init);
    setFieldErrors({});
    setSaveErrorHe('');
    setSaveSuccessHe('');
  };

  useEffect(() => {
    resetFromSection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.version, clientId]);

  const openEditModal = () => {
    resetFromSection();
    setEditOpen(true);
  };

  const closeEditModal = () => {
    if (saveBusy) return;
    resetFromSection();
    setEditOpen(false);
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveBusy(true);
    setSaveErrorHe('');
    setSaveSuccessHe('');
    setFieldErrors({});
    try {
      const payload = {
        expected_version: section.version,
        business_domain: asStringOrNull(draft.business_domain as string | null | undefined),
        business_activity_description: asStringOrNull(draft.business_activity_description as string | null | undefined),
        business_address: asStringOrNull(draft.business_address as string | null | undefined),
        private_address: asStringOrNull(draft.private_address as string | null | undefined),
        business_operation_mode: (draft.business_operation_mode as string | null | undefined) ?? null,
        primary_customer_type: (draft.primary_customer_type as string | null | undefined) ?? null,
        is_seasonal_business: Boolean(draft.is_seasonal_business),
        peak_months: Array.isArray(draft.peak_months) ? (draft.peak_months as number[]) : [],
        business_open_date: (draft.business_open_date as string | null | undefined) ?? null,
        business_close_date: (draft.business_close_date as string | null | undefined) ?? null,
      };

      const fullCase = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({ type: 'save_accounting_business_profile', payload }),
      });
      onCaseUpdated(fullCase);
      setSaveSuccessHe('נשמר בהצלחה');
      setEditOpen(false);
    } catch (e) {
      const ae = e as ApiError;
      const raw = ae.details?.field_errors;
      if (Array.isArray(raw)) {
        const fe: Partial<Record<BusinessProfileSectionFieldKey, string>> = {};
        for (const item of raw as Array<{ key?: string; message_he?: string }>) {
          if (item.key && item.message_he) fe[item.key as BusinessProfileSectionFieldKey] = item.message_he;
        }
        setFieldErrors(fe);
      }
      if (ae.message) setSaveErrorHe(ae.message);
      else setSaveErrorHe('שגיאת שמירה');
    } finally {
      setSaveBusy(false);
    }
  };

  const renderReadOnlyGrid = () => (
    (() => {
      const grouped = section.fields
        .filter((f) => f.visible)
        .reduce<Map<string, { key: string; title: string; order: number; fields: ClientBusinessProfileField[] }>>((acc, f) => {
          const ex = acc.get(f.group_key);
          if (ex) {
            ex.fields.push(f);
            return acc;
          }
          acc.set(f.group_key, {
            key: f.group_key,
            title: f.group_label,
            order: f.group_order,
            fields: [f],
          });
          return acc;
        }, new Map());

      const groups = Array.from(grouped.values())
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
        .map((g) => ({
          ...g,
          fields: g.fields.sort((a, b) => a.row_order - b.row_order || a.label.localeCompare(b.label)),
        }));

      const columns = groups.map((g) => g.fields);
      const gridTemplateColumns = groups.length ? `repeat(${groups.length}, minmax(0,1fr))` : '1fr';
      const maxRows = Math.max(0, ...columns.map((c) => c.length));

      return (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns,
              columnGap: 12,
              background: '#f8fafc',
              borderBottom: '1px solid #67e8f9',
            }}
          >
            {groups.map((g) => (
              <div key={g.key} style={{ padding: '10px 12px', fontSize: 16, fontWeight: 700 }}>
                {g.title}
              </div>
            ))}
          </div>

          {Array.from({ length: maxRows }).map((_, idx) => (
            <div
              key={`bizprofile-row-${idx}`}
              style={{
                display: 'grid',
                gridTemplateColumns,
                columnGap: 12,
                borderTop: idx > 0 ? '1px solid #67e8f9' : 'none',
              }}
            >
              {columns.map((col, colIdx) => {
                const f = col[idx];
                return (
                  <div
                    key={`bizprofile-cell-${colIdx}-${idx}`}
                    style={{
                      minHeight: 52,
                      padding: '8px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 2,
                    }}
                  >
                    {f ? (
                      <>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          {f.label}
                          {f.required ? ' *' : null}
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            whiteSpace: f.type === 'textarea' ? 'pre-wrap' : 'normal',
                          }}
                        >
                          {formatDisplayValue(f, f.value)}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      );
    })()
  );

  const renderEditorGrid = () => (
    <div className="client-profile-grid">
      {fieldOrder.map((f) => {
          const fieldError = fieldErrors[f.key];

          const commonLabel = (
            <div className="client-field-label">
              {f.label}
              {f.required ? ' *' : null}
            </div>
          );

          const commonError = fieldError ? (
            <div style={{ marginTop: 6, color: '#b91c1c', fontWeight: 700, fontSize: 12 }}>{fieldError}</div>
          ) : null;

          const disabled = !f.editable || saveBusy;

          if (f.type === 'text') {
            return (
              <div key={f.key} className="client-field">
                {commonLabel}
                <div className="client-field-box">
                  <input
                    value={(draft[f.key] as string | null | undefined) ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    aria-label={f.label}
                    disabled={disabled}
                    maxLength={f.max_length}
                    style={{ border: 'none', background: 'transparent', boxShadow: 'none', padding: 0, width: '100%', outline: 'none', font: 'inherit' }}
                  />
                </div>
                {commonError}
              </div>
            );
          }

          if (f.type === 'textarea') {
            return (
              <div key={f.key} className="client-field client-field-full">
                {commonLabel}
                <div className="client-field-box">
                  <textarea
                    value={(draft[f.key] as string | null | undefined) ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    aria-label={f.label}
                    disabled={disabled}
                    maxLength={f.max_length}
                    rows={3}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, width: '100%', outline: 'none', font: 'inherit', resize: 'vertical' }}
                  />
                </div>
                {commonError}
              </div>
            );
          }

          if (f.type === 'enum_single') {
            const empty = !((draft[f.key] as string | null | undefined) ?? '');
            return (
              <div key={f.key} className="client-field">
                {commonLabel}
                <div className="client-field-box">
                  <select
                    value={(draft[f.key] as string | null | undefined) ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [f.key]: e.target.value ? e.target.value : null,
                      }))
                    }
                    aria-label={f.label}
                    disabled={disabled}
                    className={empty ? 'client-field-select-choose' : undefined}
                    style={{ border: 'none', background: 'transparent', padding: 0, width: '100%', outline: 'none', font: 'inherit', appearance: 'none' }}
                  >
                    <option value="">{empty ? 'בחר' : '—'}</option>
                    {(f.options ?? []).map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {commonError}
              </div>
            );
          }

          if (f.type === 'boolean') {
            const boolVal = Boolean(draft[f.key]);
            return (
              <div key={f.key} className="client-field">
                {commonLabel}
                <div className="client-field-box">
                  <select
                    value={boolVal ? 'true' : 'false'}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value === 'true' }))}
                    aria-label={f.label}
                    disabled={disabled}
                    style={{ border: 'none', background: 'transparent', padding: 0, width: '100%', outline: 'none', font: 'inherit', appearance: 'none' }}
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={String(o.value)} value={o.value ? 'true' : 'false'}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {commonError}
              </div>
            );
          }

          if (f.type === 'date') {
            return (
              <div key={f.key} className="client-field">
                {commonLabel}
                <div className="client-field-box">
                  <input
                    type="date"
                    value={asDateInputValue(draft[f.key] as string | null | undefined)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [f.key]: e.target.value ? e.target.value : null,
                      }))
                    }
                    aria-label={f.label}
                    disabled={disabled}
                    style={{ border: 'none', background: 'transparent', boxShadow: 'none', padding: 0, width: '100%', outline: 'none', font: 'inherit' }}
                  />
                </div>
                {commonError}
              </div>
            );
          }

          if (f.type === 'multi_enum') {
            const selected = Array.isArray(draft[f.key]) ? (draft[f.key] as number[]) : [];
            const selectedSet = new Set(selected);
            return (
              <div key={f.key} className="client-field client-field-full">
                {commonLabel}
                <div className="client-field-box">
                  <div className="nx-peak-months-row">
                    {(f.options ?? []).map((o) => {
                      const month = Number(o.value);
                      const checked = selectedSet.has(month);
                      return (
                        <label key={String(o.value)} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) => {
                              const next = new Set(selectedSet);
                              if (e.target.checked) next.add(month);
                              else next.delete(month);
                              setDraft((d) => ({ ...d, [f.key]: Array.from(next).sort((a, b) => a - b) }));
                            }}
                          />
                          <span>{o.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                {commonError}
              </div>
            );
          }

          return null;
        })}
    </div>
  );

  return (
    <>
      <div className="client-profile-card nx-taxes-workspace" style={{ maxWidth: '100%', direction: 'rtl' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <h3 className="nx-accounting-section-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {section.section_label}
          </h3>
          {canEdit ? (
            <button
              type="button"
              className="nx-taxes-section-edit-btn"
              onClick={openEditModal}
              aria-label="עריכת פרופיל עסקי"
              title="עריכת פרופיל עסקי"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
          ) : null}
        </div>
        {saveSuccessHe && !editOpen ? (
          <span className="nx-workspace-save-success" role="status" aria-live="polite" style={{ display: 'block', marginBottom: 8 }}>
            {saveSuccessHe}
          </span>
        ) : null}
        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 14,
            background: '#fafafa',
            minWidth: 0,
          }}
        >
          {renderReadOnlyGrid()}
        </section>
      </div>

      {editOpen ? (
        <div
          className="nx-modal-overlay"
          style={{ zIndex: 10000 }}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditModal();
          }}
        >
          <div className="nx-modal nx-accounting-editor-modal" role="dialog" aria-modal="true" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">{section.section_label}</h3>
            </div>
            <div className="nx-modal-body" style={{ flex: '0 1 auto' }}>
              {renderEditorGrid()}
              {saveErrorHe ? (
                <p style={{ color: '#b91c1c', fontWeight: 700, margin: '12px 0 0', fontSize: 14 }}>{saveErrorHe}</p>
              ) : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {canEdit ? (
                <>
                  <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" style={{ minWidth: 96 }} onClick={() => void handleSave()} disabled={saveBusy}>
                    {saveBusy ? 'שומר…' : 'שמירה'}
                  </button>
                  <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" style={{ minWidth: 96 }} onClick={closeEditModal} disabled={saveBusy}>
                    ביטול
                  </button>
                </>
              ) : (
                <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" style={{ minWidth: 96 }} onClick={closeEditModal}>
                  סגירה
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
