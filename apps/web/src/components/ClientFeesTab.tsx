import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { moduleClientOperationsCase, moduleClientOperationsFeesCommands } from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import type {
  FeesAgreementFieldModel,
  FeesEditModalSectionKey,
  FeesKeyValueCardModel,
  FeesPriceHistoryChartModel,
  FeesPriceHistoryChartViewMode,
  FeesRenewalCardModel,
  FeesTabModel,
  FeesTableSectionModel,
} from './fees-tab-types';
import '../styles/nx-fees-tab.css';
import '../styles/nx-modal.css';

export type { FeesTabModel } from './fees-tab-types';

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

/** Primary blue pencil — workspace edit entry (no "ערוך" text button). */
function IconPencil() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
    </svg>
  );
}

/** תצוגה בלבד — ערכים מהאגרגט; החיתוך ל-15/הכל בשרת */
function FeesPriceHistoryChart({
  chart,
  onChartViewRequest,
}: {
  chart: FeesPriceHistoryChartModel;
  onChartViewRequest: (mode: FeesPriceHistoryChartViewMode) => void | Promise<void>;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (chart.bars.length === 0) {
    return <div className="nx-fees-empty">{chart.empty_state_he}</div>;
  }

  const visibleBars = chart.bars;

  return (
    <div className="nx-fees-price-chart-block">
      {chart.view_caption_he ? <p className="nx-fees-price-chart-view-caption">{chart.view_caption_he}</p> : null}
      {chart.overflow_hint_he ? <p className="nx-fees-price-chart-overflow-hint">{chart.overflow_hint_he}</p> : null}
      {chart.subtitle_he ? <p className="nx-fees-price-chart-sub">{chart.subtitle_he}</p> : null}
      {chart.y_axis_hint_he ? <p className="nx-fees-price-chart-hint">{chart.y_axis_hint_he}</p> : null}

      <div className="nx-fees-price-chart-toolbar nx-fees-price-chart-toolbar--modes" dir="rtl">
        <button
          type="button"
          className={`nx-fees-price-chart-toggle ${chart.chart_view_mode === 'last_15' ? 'nx-fees-price-chart-toggle--active' : ''}`}
          onClick={() => void onChartViewRequest('last_15')}
        >
          {chart.toggle_last_15_label_he}
        </button>
        <button
          type="button"
          className={`nx-fees-price-chart-toggle ${chart.chart_view_mode === 'all' ? 'nx-fees-price-chart-toggle--active' : ''}`}
          onClick={() => void onChartViewRequest('all')}
        >
          {chart.toggle_all_label_he}
        </button>
      </div>

      <div className="nx-fees-price-chart-scroll">
        <div className="nx-fees-price-chart" role="img" aria-label="היסטוריית שינויי מחיר">
          {visibleBars.map((b, i) => (
            <div
              key={`${b.x_label_he}-${i}-${b.snapshot_after_he}`}
              className="nx-fees-price-chart-col"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {hoverIdx === i ? (
                <div className="nx-fees-price-chart-tooltip" role="tooltip" dir="rtl">
                  {b.tooltip_lines_he.map((line, li) => (
                    <p key={li} className="nx-fees-price-chart-tooltip-line">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
              <span className="nx-fees-price-chart-value">{b.snapshot_after_he ?? '—'}</span>
              {b.delta_primary_he ? (
                <span className={`nx-fees-price-chart-delta nx-fees-price-chart-delta--${b.direction}`}>{b.delta_primary_he}</span>
              ) : null}
              <div className="nx-fees-price-chart-bar-wrap">
                <div
                  className={`nx-fees-price-chart-bar nx-fees-price-chart-bar--${b.direction}`}
                  style={{ height: `${b.bar_height_0_100}%` }}
                  aria-hidden
                />
              </div>
              <span className="nx-fees-price-chart-x">{b.x_label_he}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgreementSummaryDisplay({ feesTab }: { feesTab: FeesTabModel }) {
  const s = feesTab.agreement_summary;
  if (s.no_agreement_summary_he) {
    return <div className="nx-fees-empty">{s.no_agreement_summary_he}</div>;
  }
  return (
    <ul className="nx-fees-summary-lines nx-fees-workspace-readonly">
      {s.lines.map((ln, i) => (
        <li key={i} className="nx-fees-summary-line">
          <span className="nx-fees-summary-label">{ln.label_he}</span>
          <span className="nx-fees-summary-value">{ln.value_he}</span>
        </li>
      ))}
    </ul>
  );
}

function ServicesDisplayTable({ section }: { section: FeesTableSectionModel }) {
  if (section.rows.length === 0) {
    return <div className="nx-fees-empty">{section.empty_state_he}</div>;
  }
  return (
    <div className="nx-fees-table-wrap">
      <table className="nx-fees-data-table nx-fees-workspace-display-table">
        <thead>
          <tr>
            {section.column_headers_he.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, ri) => (
            <tr key={row.line_id || ri}>
              {row.cells_he.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiscountCardDisplay({ card }: { card: FeesKeyValueCardModel }) {
  return (
    <div className="nx-fees-kv-display nx-fees-workspace-readonly">
      {card.lines.map((ln, i) => (
        <div key={i} className="nx-fees-kv-row">
          <span className="nx-fees-kv-label">{ln.label_he}</span>
          <span className="nx-fees-kv-value">{ln.value_he}</span>
        </div>
      ))}
    </div>
  );
}

function RenewalSummaryDisplay({ renewal }: { renewal: FeesRenewalCardModel }) {
  return (
    <div className="nx-fees-workspace-readonly">
      {renewal.banner ? (
        <div className={`nx-fees-renewal-banner nx-fees-renewal-banner--${renewal.banner.variant}`}>{renewal.banner.text_he}</div>
      ) : null}
      <ul className="nx-fees-summary-lines">
        {renewal.lines.map((ln, i) => (
          <li key={i} className="nx-fees-summary-line">
            <span className="nx-fees-summary-label">{ln.label_he}</span>
            <span className="nx-fees-summary-value">{ln.value_he}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeesWorkspaceBlockHeader({
  title,
  chip,
  canEdit,
  onEdit,
}: {
  title: string;
  chip?: ReactNode;
  canEdit: boolean;
  onEdit?: () => void;
}) {
  return (
    <div className="nx-fees-workspace-card-head">
      <div className="nx-fees-workspace-card-head-main">
        <h3 className="nx-fees-card-title nx-fees-card-title--strict">{title}</h3>
        {chip}
      </div>
      {canEdit && onEdit ? (
        <button type="button" className="nx-fees-pencil-btn" onClick={onEdit} aria-label="עריכה" title="עריכה">
          <IconPencil />
        </button>
      ) : null}
    </div>
  );
}

function allEditFields(tab: FeesTabModel): FeesAgreementFieldModel[] {
  return tab.edit_modal.sections.flatMap((s) => s.fields);
}

function mergedEditFieldValue(key: string, draft: Record<string, unknown>, tab: FeesTabModel): unknown {
  if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
  return allEditFields(tab).find((x) => x.key === key)?.value;
}

function feeModalClauseMatches(v: unknown, any_of: string[]): boolean {
  const s =
    v === true || v === 'yes' || v === 'כן' ? 'yes' : v === false || v === 'no' || v === 'לא' ? 'no' : String(v ?? '');
  return any_of.includes(s);
}

/** תצוגת שדה במודאל — תלוי בטיוטה + אגרגט; שדות עם modal_visible_when נקבעים בשרת */
function feeModalFieldShown(f: FeesAgreementFieldModel, draft: Record<string, unknown>, tab: FeesTabModel): boolean {
  if (!f.editable) return false;
  const when = f.modal_visible_when;
  if (!when?.length) return f.visible;
  return when.every(({ field_key, any_of }) => feeModalClauseMatches(mergedEditFieldValue(field_key, draft, tab), any_of));
}

function sectionFields(tab: FeesTabModel, sectionKey: FeesEditModalSectionKey): FeesAgreementFieldModel[] {
  return tab.edit_modal.sections.find((s) => s.section_key === sectionKey)?.fields ?? [];
}

function editModalSectionTitle(tab: FeesTabModel, sectionKey: FeesEditModalSectionKey): string {
  return tab.edit_modal.sections.find((s) => s.section_key === sectionKey)?.section_title_he ?? '';
}

/** שורות grid לפי מפתחות — רק layout; אותם שדות מהאגרגט (fees_agreement) */
const FEES_AGREEMENT_FIELD_ROWS: string[][] = [
  ['agreement_start_date', 'agreement_end_date'],
  ['auto_renewal', 'has_agreement'],
  ['billing_day_range', 'agreement_status'],
];

/** הסכם במודאל — סדר ושדות מהאגרגט בלבד (visible + editable) */
function AgreementSectionFields({
  feesTab,
  draft,
  canEdit,
  onDraftChange,
}: {
  feesTab: FeesTabModel;
  draft: Record<string, unknown>;
  canEdit: boolean;
  onDraftChange: (key: string, v: unknown) => void;
}) {
  const fields = sectionFields(feesTab, 'fees_agreement').filter((f) => f.visible && f.editable);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const used = new Set<string>();
  return (
    <div className="nx-fees-modal-agreement-fields nx-fees-modal-agreement-fields--grid">
      {FEES_AGREEMENT_FIELD_ROWS.map((keys, ri) => {
        const rowFields = keys.map((k) => byKey.get(k)).filter((f): f is FeesAgreementFieldModel => Boolean(f));
        rowFields.forEach((f) => used.add(f.key));
        if (rowFields.length === 0) return null;
        return (
          <div
            key={ri}
            className={
              rowFields.length === 1
                ? 'nx-fees-modal-agreement-row nx-fees-modal-agreement-row--single'
                : 'nx-fees-modal-agreement-row'
            }
          >
            {rowFields.map((f) => (
              <div key={f.key} className="client-field nx-fees-modal-agreement-field-cell">
                <div className="client-field-label">{f.label_he}</div>
                <FeeFieldInput f={f} value={draft[f.key]} disabled={!canEdit || !f.editable} onChange={onDraftChange} />
              </div>
            ))}
          </div>
        );
      })}
      {fields
        .filter((f) => !used.has(f.key))
        .map((f) => (
          <div key={f.key} className="nx-fees-modal-agreement-row nx-fees-modal-agreement-row--single">
            <div className="client-field nx-fees-modal-agreement-field-cell">
              <div className="client-field-label">{f.label_he}</div>
              <FeeFieldInput f={f} value={draft[f.key]} disabled={!canEdit || !f.editable} onChange={onDraftChange} />
            </div>
          </div>
        ))}
    </div>
  );
}

/** שדות הנחה — רק לפי visible/editable מהאגרגט; סוג + אחוז/סכום בשורה אחת */
function DiscountSectionFields({
  feesTab,
  draft,
  canEdit,
  onDraftChange,
}: {
  feesTab: FeesTabModel;
  draft: Record<string, unknown>;
  canEdit: boolean;
  onDraftChange: (key: string, v: unknown) => void;
}) {
  const fields = sectionFields(feesTab, 'fees_discount').filter((f) => feeModalFieldShown(f, draft, feesTab));
  const byKey = (k: string) => fields.find((f) => f.key === k);
  const hasDisc = byKey('discount_has');
  const typ = byKey('discount_type');
  const pct = byKey('discount_percent');
  const amt = byKey('discount_amount_ils');
  const amountOrPercent = pct ?? amt;

  return (
    <>
      {hasDisc ? (
        <div key={hasDisc.key} className="client-field nx-fees-discount-field--full">
          <div className="client-field-label">{hasDisc.label_he}</div>
          <FeeFieldInput f={hasDisc} value={draft[hasDisc.key]} disabled={!canEdit || !hasDisc.editable} onChange={onDraftChange} />
        </div>
      ) : null}
      {typ && amountOrPercent ? (
        <div className="nx-fees-discount-inline-pair" dir="rtl">
          <div key={typ.key} className="client-field nx-fees-discount-field--full">
            <div className="client-field-label">{typ.label_he}</div>
            <FeeFieldInput f={typ} value={draft[typ.key]} disabled={!canEdit || !typ.editable} onChange={onDraftChange} />
          </div>
          <div key={amountOrPercent.key} className="client-field nx-fees-discount-field--full">
            <div className="client-field-label">{amountOrPercent.label_he}</div>
            <FeeFieldInput
              f={amountOrPercent}
              value={draft[amountOrPercent.key]}
              disabled={!canEdit || !amountOrPercent.editable}
              onChange={onDraftChange}
            />
          </div>
        </div>
      ) : typ ? (
        <div key={typ.key} className="client-field nx-fees-discount-field--full">
          <div className="client-field-label">{typ.label_he}</div>
          <FeeFieldInput f={typ} value={draft[typ.key]} disabled={!canEdit || !typ.editable} onChange={onDraftChange} />
        </div>
      ) : null}
    </>
  );
}

/** מעקב חידוש — כל השדות הגלויים בשורה אחת, רוחב שווה */
function RenewalSideFieldsRow({
  feesTab,
  draft,
  canEdit,
  onDraftChange,
}: {
  feesTab: FeesTabModel;
  draft: Record<string, unknown>;
  canEdit: boolean;
  onDraftChange: (key: string, v: unknown) => void;
}) {
  const fields = sectionFields(feesTab, 'fees_renewal').filter((f) => f.visible && f.editable);
  const gridTemplateColumns =
    fields.length === 0
      ? '1fr'
      : fields.map((f) => (f.key === 'reminder_days_before' ? 'minmax(72px, 104px)' : 'minmax(0, 1fr)')).join(' ');
  return (
    <div className="nx-fees-renewal-fields-row" style={{ gridTemplateColumns }}>
      {fields.map((f) => (
        <div
          key={f.key}
          className={
            f.key === 'reminder_days_before'
              ? 'client-field nx-fees-renewal-field-cell nx-fees-renewal-field-cell--reminder'
              : 'client-field nx-fees-renewal-field-cell'
          }
        >
          <div className="client-field-label">{f.label_he}</div>
          <FeeFieldInput f={f} value={draft[f.key]} disabled={!canEdit || !f.editable} onChange={onDraftChange} />
        </div>
      ))}
    </div>
  );
}

/** ערך ל־JSON לפי סוג השדה מהאגרגט — לא כללי עסקיים */
function wireFieldValueForCommand(f: FeesAgreementFieldModel, v: unknown): unknown {
  if (f.type === 'radio') {
    if (v === undefined) return undefined;
    return v === true || v === 'yes' || v === 'כן' ? 'yes' : 'no';
  }
  if (f.type === 'number') {
    return v === '' || v == null ? null : Number(v);
  }
  return v === '' ? null : v;
}

/** payload.agreement לפי edit_modal.sections[].fields (מאגרגט) + טיוטה מקומית */
function agreementPayloadFromDraft(tab: FeesTabModel, draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of allEditFields(tab)) {
    if (!f.editable) continue;
    const w = wireFieldValueForCommand(f, draft[f.key]);
    if (w !== undefined) out[f.key] = w;
  }
  return out;
}

function FeeFieldInput({
  f,
  value,
  disabled,
  onChange,
}: {
  f: FeesAgreementFieldModel;
  value: unknown;
  disabled: boolean;
  onChange: (key: string, v: unknown) => void;
}) {
  const common = { disabled, id: `fee-f-${f.key}` };
  if (f.type === 'textarea') {
    return (
      <textarea
        {...common}
        className="client-field-box-input nx-fees-inp"
        rows={3}
        value={value != null ? String(value) : ''}
        onChange={(e) => onChange(f.key, e.target.value)}
        style={{ width: '100%' }}
      />
    );
  }
  if (f.type === 'radio' && f.options) {
    const cur = value === true || value === 'yes' || value === 'כן' ? 'yes' : value === false || value === 'no' ? 'no' : String(value ?? '');
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {f.options.map((o) => (
          <label key={o.value} style={{ display: 'inline-flex', gap: 6, cursor: disabled ? 'default' : 'pointer' }}>
            <input
              type="radio"
              name={`fee-r-${f.key}`}
              checked={cur === o.value}
              onChange={() => onChange(f.key, o.value)}
              {...common}
            />
            <span>{o.label_he}</span>
          </label>
        ))}
      </div>
    );
  }
  if (f.type === 'select' && f.options) {
    return (
      <select
        {...common}
        className="nx-fees-inp"
        value={value != null ? String(value) : ''}
        onChange={(e) => onChange(f.key, e.target.value || null)}
      >
        <option value="">—</option>
        {f.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label_he}
          </option>
        ))}
      </select>
    );
  }
  if (f.type === 'date') {
    return (
      <input
        type="date"
        {...common}
        className="nx-fees-inp"
        value={value != null ? String(value).slice(0, 10) : ''}
        onChange={(e) => onChange(f.key, e.target.value || null)}
      />
    );
  }
  if (f.type === 'number') {
    return (
      <input
        type="number"
        {...common}
        className="nx-fees-inp"
        value={value != null && value !== '' ? String(value) : ''}
        onChange={(e) => onChange(f.key, e.target.value === '' ? null : e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      {...common}
      className="nx-fees-inp"
      value={value != null ? String(value) : ''}
      onChange={(e) => onChange(f.key, e.target.value)}
    />
  );
}

const FEES_HISTORY_PREVIEW_COUNT = 2;
const FEES_HISTORY_SHOW_LESS_HE = 'הצג פחות';

export function ClientFeesTab({
  clientId,
  feesTab,
  onCaseUpdated,
}: {
  clientId: string;
  feesTab: FeesTabModel;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [includedLines, setIncludedLines] = useState<Array<Record<string, unknown>>>([]);
  const [customLines, setCustomLines] = useState<Array<Record<string, unknown>>>([]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [recentHistoryExpanded, setRecentHistoryExpanded] = useState(false);
  const [feesEditOpen, setFeesEditOpen] = useState(false);
  const [fxDialog, setFxDialog] = useState<null | { scope: 'inc' | 'cust'; line: Record<string, unknown>; currencyCode: string }>(null);
  const [fxRateDraft, setFxRateDraft] = useState('');

  const v = feesTab.visibility;
  const canEdit = feesTab.permissions.can_edit;

  const syncFromTab = useCallback((t: FeesTabModel) => {
    const d: Record<string, unknown> = {};
    for (const sec of t.edit_modal.sections) {
      for (const f of sec.fields) {
        if (f.type === 'radio') {
          d[f.key] = f.value === true || f.value === 'yes' ? 'yes' : f.value === false || f.value === 'no' ? 'no' : f.value;
        } else d[f.key] = f.value;
      }
    }
    setDraft(d);
    setIncludedLines(t.edit_modal.included_lines_editor.rows.map((r) => ({ ...r.persist_line })));
    setCustomLines(t.edit_modal.custom_lines_editor.rows.map((r) => ({ ...r.persist_line })));
  }, []);

  useEffect(() => {
    syncFromTab(feesTab);
  }, [clientId, feesTab.read_model_version, feesTab.agreement_id, syncFromTab]);

  useEffect(() => {
    setRecentHistoryExpanded(false);
  }, [feesTab.read_model_version, feesTab.agreement_id]);

  useEffect(() => {
    if (!fxDialog) {
      setFxRateDraft('');
      return;
    }
    const { line, currencyCode } = fxDialog;
    if (String(line.currency_code ?? '') === currencyCode && line.exchange_rate_to_ils != null) {
      setFxRateDraft(String(line.exchange_rate_to_ils));
    } else {
      setFxRateDraft('');
    }
  }, [fxDialog]);

  const onDraftChange = (key: string, val: unknown) => {
    setDraft((s) => ({ ...s, [key]: val }));
  };

  const patchIncludedLineDraft = (idx: number, patch: Record<string, unknown>) => {
    setIncludedLines((prev) => prev.map((line, lineIdx) => (lineIdx === idx ? { ...line, ...patch } : line)));
  };

  const patchCustomLineDraft = (idx: number, patch: Record<string, unknown>) => {
    setCustomLines((prev) => prev.map((line, lineIdx) => (lineIdx === idx ? { ...line, ...patch } : line)));
  };

  const postFeesCommand = useCallback(
    async (type: string, payload: Record<string, unknown>) => {
      return apiJson<ClientOperationsCaseResponse>(moduleClientOperationsFeesCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload,
          expected_version: feesTab.read_model_version,
          fees_price_chart_view: feesTab.price_history.chart.chart_view_mode,
        }),
      });
    },
    [clientId, feesTab.read_model_version, feesTab.price_history.chart.chart_view_mode]
  );

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      const agreement = agreementPayloadFromDraft(feesTab, draft);

      const out = await postFeesCommand('update_fee_agreement', { agreement });
      onCaseUpdated(out);
      setFeesEditOpen(false);
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const deleteIncludedRow = async (idx: number) => {
    if (!canEdit) return;
    const rowM = feesTab.included_services.rows[idx];
    if (rowM?.deactivate_action?.enabled === false) return;
    const lineId = String(includedLines[idx]?.line_id ?? '');
    if (!lineId || lineId.startsWith('temp-')) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      const out = await postFeesCommand('remove_fee_service_line', { line_id: lineId });
      onCaseUpdated(out);
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const deleteCustomRow = async (idx: number) => {
    if (!canEdit) return;
    const rowM = feesTab.custom_services.rows[idx];
    if (rowM?.deactivate_action?.enabled === false) return;
    const lineId = String(customLines[idx]?.line_id ?? '');
    if (!lineId || lineId.startsWith('temp-')) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      const out = await postFeesCommand('remove_custom_fee_service_line', { line_id: lineId });
      onCaseUpdated(out);
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const incEd = feesTab.edit_modal.included_lines_editor;
  const custEd = feesTab.edit_modal.custom_lines_editor;
  const L = feesTab.line_editor_labels;
  const vatModeOptions = feesTab.vat_mode_options;
  const incHeaders = feesTab.included_services.column_headers_he;
  const custHeaders = feesTab.custom_services.column_headers_he;
  const fxMeta = feesTab.fee_line_exchange_rate_modal;
  const curOpts = feesTab.fee_line_currency_options;

  const showLines = true;
  const canAddInc = incEd.add_button && incEd.add_button.enabled && showLines && includedLines.length < incEd.max_lines;
  const canAddCust = custEd.add_button && custEd.add_button.enabled && showLines && customLines.length < custEd.max_lines;

  const commitIncludedLine = async (nextLine: Record<string, unknown>): Promise<boolean> => {
    const lineId = String(nextLine.line_id ?? '');
    if (!lineId || lineId.startsWith('temp-')) return false;
    setSaveError('');
    try {
      const out = await postFeesCommand('update_fee_service_line', {
        line_id: lineId,
        catalog_code: nextLine.catalog_code,
        display_name_he: nextLine.display_name_he,
        charging_type: nextLine.charging_type,
        price_ils: nextLine.price_ils,
        vat_mode: nextLine.vat_mode,
        is_active: nextLine.is_active,
        payslip_count: nextLine.payslip_count,
        unit_price_ils: nextLine.unit_price_ils,
        quantity: nextLine.quantity,
        currency_code: nextLine.currency_code,
        exchange_rate_to_ils: nextLine.exchange_rate_to_ils,
      });
      onCaseUpdated(out);
      return true;
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
      return false;
    }
  };

  const commitCustomLine = async (nextLine: Record<string, unknown>): Promise<boolean> => {
    const lineId = String(nextLine.line_id ?? '');
    if (!lineId || lineId.startsWith('temp-')) return false;
    setSaveError('');
    try {
      const out = await postFeesCommand('update_custom_fee_service_line', {
        line_id: lineId,
        display_name_he: nextLine.display_name_he,
        charging_type: nextLine.charging_type,
        price_ils: nextLine.price_ils,
        is_active: nextLine.is_active,
        quantity: nextLine.quantity,
        currency_code: nextLine.currency_code,
        exchange_rate_to_ils: nextLine.exchange_rate_to_ils,
      });
      onCaseUpdated(out);
      return true;
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
      return false;
    }
  };

  const hasLineChanged = (baseline: Record<string, unknown> | undefined, candidate: Record<string, unknown>, keys: string[]) =>
    keys.some((key) => (baseline?.[key] ?? null) !== (candidate[key] ?? null));

  const openFxDialog = (scope: 'inc' | 'cust', line: Record<string, unknown>, currencyCode: string) => {
    setFxDialog({ scope, line, currencyCode });
  };

  const onIncludedCurrencySelect = (line: Record<string, unknown>, newCode: string) => {
    if (String(line.catalog_code ?? '') === 'salary_by_payslips') return;
    if (newCode === 'ILS') {
      void commitIncludedLine({ ...line, currency_code: 'ILS', exchange_rate_to_ils: null });
      return;
    }
    const cur = String(line.currency_code ?? 'ILS');
    const rate = line.exchange_rate_to_ils;
    if (cur === newCode && rate != null && Number(rate) > 0) return;
    openFxDialog('inc', line, newCode);
  };

  const onCustomCurrencySelect = (line: Record<string, unknown>, newCode: string) => {
    if (newCode === 'ILS') {
      void commitCustomLine({ ...line, currency_code: 'ILS', exchange_rate_to_ils: null });
      return;
    }
    const cur = String(line.currency_code ?? 'ILS');
    const rate = line.exchange_rate_to_ils;
    if (cur === newCode && rate != null && Number(rate) > 0) return;
    openFxDialog('cust', line, newCode);
  };

  const confirmFxRate = async () => {
    if (!fxDialog) return;
    const r = Number(String(fxRateDraft).replace(',', '.'));
    if (!Number.isFinite(r) || r <= 0) return;
    const next = { ...fxDialog.line, currency_code: fxDialog.currencyCode, exchange_rate_to_ils: r };
    const ok =
      fxDialog.scope === 'inc' ? await commitIncludedLine(next) : await commitCustomLine(next);
    if (ok) setFxDialog(null);
  };

  const addIncluded = async () => {
    if (!canAddInc || !incEd.add_button) return;
    if (includedLines.length >= incEd.max_lines) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      const out = await postFeesCommand('add_fee_service_line', {});
      onCaseUpdated(out);
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const addCustom = async () => {
    if (!canAddCust || !custEd.add_button) return;
    if (customLines.length >= custEd.max_lines) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      const out = await postFeesCommand('add_custom_fee_service_line', {});
      onCaseUpdated(out);
    } catch (e) {
      setSaveError(userFacingApiMessage(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const openFeesModal = () => setFeesEditOpen(true);

  return (
    <div className="nx-fees-tab-root">
      <div className="nx-fees-tab-shell">
        <div className="nx-fees-container">
          <p className="nx-fees-meta-strip">
            <span>
              {feesTab.meta.updated_last_label_he} {feesTab.meta.updated_last_display_he}
            </span>
            <span className="nx-fees-meta-sep" aria-hidden>
              {' · '}
            </span>
            <span>
              {feesTab.meta.updated_by_label_he} {feesTab.meta.updated_by_display_he}
            </span>
          </p>

          <div className="nx-fees-grid">
            <div className="nx-fees-main-col" dir="rtl">
              {v.show_agreement_details ? (
                <div className="nx-fees-card">
                  <FeesWorkspaceBlockHeader
                    title={feesTab.agreement_summary.card_title_he}
                    chip={
                      feesTab.agreement_summary.status_chip ? (
                        <span className="nx-fees-status-chip">{feesTab.agreement_summary.status_chip.label_he}</span>
                      ) : null
                    }
                    canEdit={canEdit}
                    onEdit={openFeesModal}
                  />
                  <AgreementSummaryDisplay feesTab={feesTab} />
                </div>
              ) : null}

              {v.show_agreement_details && showLines ? (
                <div className="nx-fees-card">
                  <FeesWorkspaceBlockHeader title={incEd.section_title_he} canEdit={canEdit} onEdit={openFeesModal} />
                  <ServicesDisplayTable section={feesTab.included_services} />
                </div>
              ) : null}

              {v.show_agreement_details && showLines ? (
                <div className="nx-fees-card">
                  <FeesWorkspaceBlockHeader title={custEd.section_title_he} canEdit={canEdit} onEdit={openFeesModal} />
                  <ServicesDisplayTable section={feesTab.custom_services} />
                </div>
              ) : null}

              {v.show_agreement_details && v.show_price_history ? (
                <div className="nx-fees-card" id={feesTab.price_history.section_anchor_id}>
                  <h3 className="nx-fees-card-title nx-fees-card-title--strict nx-fees-workspace-block-title-only">
                    {feesTab.price_history.card_title_he}
                  </h3>
                  <FeesPriceHistoryChart
                    chart={feesTab.price_history.chart}
                    onChartViewRequest={async (mode) => {
                      const out = await apiJson<ClientOperationsCaseResponse>(
                        moduleClientOperationsCase(clientId, { fees_price_chart_view: mode })
                      );
                      onCaseUpdated(out);
                    }}
                  />
                </div>
              ) : null}
            </div>

            <aside className="nx-fees-side-col" dir="rtl">
              {v.show_agreement_details && v.show_financial_summary ? (
                <div className="nx-fees-card nx-fees-card--side nx-fees-rail--financial">
                  <h3 className="nx-fees-card-title nx-fees-card-title--strict">{feesTab.financial_summary.card_title_he}</h3>
                  <div className="nx-fees-excel-summary">
                    <table className="nx-fees-excel-table">
                      <tbody>
                        {feesTab.financial_summary.primary_value_he ? (
                          <tr className="nx-fees-excel-row nx-fees-excel-row--total">
                            <td className="nx-fees-excel-cell nx-fees-excel-cell--label">סה״כ לתשלום</td>
                            <td className="nx-fees-excel-cell nx-fees-excel-cell--amount">{feesTab.financial_summary.primary_value_he}</td>
                          </tr>
                        ) : null}
                        {feesTab.financial_summary.lines.map((ln, i) => (
                          <tr key={i} className={['nx-fees-excel-row', ln.emphasize ? 'nx-fees-excel-row--emph' : ''].filter(Boolean).join(' ')}>
                            <td className="nx-fees-excel-cell nx-fees-excel-cell--label">{ln.label_he}</td>
                            <td className="nx-fees-excel-cell nx-fees-excel-cell--amount">{ln.value_he}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {v.show_agreement_details && v.show_discount_block ? (
                <div className="nx-fees-card nx-fees-card--side">
                  <FeesWorkspaceBlockHeader
                    title={feesTab.discount_card.card_title_he || editModalSectionTitle(feesTab, 'fees_discount')}
                    canEdit={canEdit}
                    onEdit={openFeesModal}
                  />
                  <DiscountCardDisplay card={feesTab.discount_card} />
                </div>
              ) : null}

              {v.show_agreement_details && v.show_renew_section ? (
                <div className="nx-fees-card nx-fees-card--side">
                  <FeesWorkspaceBlockHeader title={feesTab.renewal.card_title_he} canEdit={canEdit} onEdit={openFeesModal} />
                  <RenewalSummaryDisplay renewal={feesTab.renewal} />
                </div>
              ) : null}

              {v.show_agreement_details && v.show_recent_history ? (
                <div className="nx-fees-card nx-fees-card--side" id={feesTab.recent_history.view_full_link.anchor_element_id}>
                  <h3 className="nx-fees-card-title nx-fees-card-title--strict">{feesTab.recent_history.card_title_he}</h3>
                  {feesTab.recent_history.events.length === 0 ? (
                    <div className="nx-fees-empty">{feesTab.recent_history.empty_state_he}</div>
                  ) : (
                    <ul className="nx-fees-recent-list">
                      {(recentHistoryExpanded ? feesTab.recent_history.events : feesTab.recent_history.events.slice(0, FEES_HISTORY_PREVIEW_COUNT)).map(
                        (ev, i) => (
                          <li key={i} className="nx-fees-recent-item">
                            <div>{ev.summary_he}</div>
                            <time>{ev.occurred_at_he}</time>
                          </li>
                        )
                      )}
                    </ul>
                  )}
                  {feesTab.recent_history.events.length > FEES_HISTORY_PREVIEW_COUNT ? (
                    <button type="button" className="nx-fees-link-like" onClick={() => setRecentHistoryExpanded((x) => !x)}>
                      {recentHistoryExpanded ? FEES_HISTORY_SHOW_LESS_HE : feesTab.recent_history.view_full_link.label_he}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </aside>
          </div>
        </div>

        {saveError ? <p className="nx-fees-save-error">{saveError}</p> : null}
      </div>

      {feesEditOpen && canEdit ? (
        <>
          <div
            className="nx-modal-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !saveBusy && !fxDialog) setFeesEditOpen(false);
            }}
          >
          <div className="nx-modal nx-fees-editor-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap">
                <h2 className="nx-modal-title">{feesTab.edit_modal.modal_title_he}</h2>
              </div>
              <button type="button" className="nx-modal-close" aria-label="סגירה" disabled={saveBusy} onClick={() => setFeesEditOpen(false)}>
                ×
              </button>
            </div>
            <div className="nx-modal-body nx-fees-editor-modal-body">
              {feesTab.edit_modal.save_hint_he ? <p className="nx-fees-modal-hint">{feesTab.edit_modal.save_hint_he}</p> : null}

              <section className="nx-fees-modal-section" aria-labelledby="fees-modal-agreement">
                <h3 id="fees-modal-agreement" className="nx-fees-modal-section-title">
                  {editModalSectionTitle(feesTab, 'fees_agreement')}
                </h3>
                <AgreementSectionFields feesTab={feesTab} draft={draft} canEdit={canEdit} onDraftChange={onDraftChange} />
              </section>

              <section className="nx-fees-modal-section" aria-labelledby="fees-modal-inc">
                <div className="nx-fees-modal-section-bar">
                  <h3 id="fees-modal-inc" className="nx-fees-modal-section-title">
                    {incEd.section_title_he}
                  </h3>
                  {canAddInc && incEd.add_button ? (
                    <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" onClick={addIncluded}>
                      {incEd.add_button.label_he}
                    </button>
                  ) : null}
                </div>
                <div className="nx-fees-table-wrap">
                  <table className="nx-fees-data-table nx-fees-services-table nx-fees-services-table--included">
                    <thead>
                      <tr>
                        {incHeaders.map((h, hi) => (
                          <th key={hi} {...(!String(h).trim() ? { 'aria-label': 'מחיקה' } : {})}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {includedLines.length === 0 ? (
                        <tr>
                          <td colSpan={incHeaders.length} className="nx-fees-empty">
                            {feesTab.included_services.empty_state_he}
                          </td>
                        </tr>
                      ) : (
                        includedLines.map((line, idx) => {
                          const rowM = feesTab.included_services.rows[idx];
                          const delLbl = rowM?.deactivate_action?.label_he ?? 'מחיקה';
                          const isPayroll = String(line.catalog_code ?? '') === 'salary_by_payslips';
                          return (
                            <Fragment key={String(line.line_id ?? idx)}>
                              <tr>
                                <td>
                                  <select
                                    className="nx-fees-inp nx-fees-inp--table"
                                    value={String(line.catalog_code ?? '')}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      const c = e.target.value;
                                      const label = feesTab.built_in_catalog.find((x) => x.code === c)?.label_he ?? '';
                                      patchIncludedLineDraft(idx, { catalog_code: c, display_name_he: label });
                                      void commitIncludedLine({
                                        ...line,
                                        catalog_code: c,
                                        display_name_he: label,
                                      });
                                    }}
                                  >
                                    {feesTab.built_in_catalog.map((o) => (
                                      <option key={o.code} value={o.code}>
                                        {o.label_he}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <select
                                    className="nx-fees-inp nx-fees-inp--table"
                                    value={String(line.charging_type ?? 'monthly')}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      patchIncludedLineDraft(idx, { charging_type: e.target.value });
                                      void commitIncludedLine({ ...line, charging_type: e.target.value });
                                    }}
                                  >
                                    {feesTab.charging_type_options.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label_he}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    className="nx-fees-inp nx-fees-inp--table"
                                    disabled={!canEdit}
                                    value={line.price_ils != null ? String(line.price_ils) : ''}
                                    onChange={(e) => patchIncludedLineDraft(idx, { price_ils: e.target.value })}
                                    onBlur={() => {
                                      const nextLine = {
                                        ...line,
                                        price_ils: line.price_ils === '' || line.price_ils == null ? 0 : Number(line.price_ils),
                                      };
                                      const baseline = incEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                      if (!hasLineChanged(baseline, nextLine, ['price_ils'])) return;
                                      void commitIncludedLine(nextLine);
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min={1}
                                    className="nx-fees-inp nx-fees-inp--table"
                                    aria-label={L.quantity_label_he}
                                    disabled={!canEdit || isPayroll}
                                    value={line.quantity != null ? String(line.quantity) : '1'}
                                    onChange={(e) => patchIncludedLineDraft(idx, { quantity: e.target.value })}
                                    onBlur={() => {
                                      const nextLine = {
                                        ...line,
                                        quantity: line.quantity === '' || line.quantity == null ? 1 : Number(line.quantity),
                                      };
                                      const baseline = incEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                      if (!hasLineChanged(baseline, nextLine, ['quantity'])) return;
                                      void commitIncludedLine(nextLine);
                                    }}
                                  />
                                </td>
                                <td>
                                  <div className="nx-fees-currency-cell">
                                    <select
                                      className="nx-fees-inp nx-fees-inp--table"
                                      aria-label={L.currency_label_he}
                                      value={String(line.currency_code ?? 'ILS')}
                                      disabled={!canEdit || isPayroll}
                                    onChange={(e) => {
                                      patchIncludedLineDraft(idx, { currency_code: e.target.value });
                                      onIncludedCurrencySelect(line, e.target.value);
                                    }}
                                    >
                                      {curOpts.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label_he}
                                        </option>
                                      ))}
                                    </select>
                                    {!isPayroll && rowM?.exchange_rate_required ? (
                                      <button
                                        type="button"
                                        className="nx-fees-link-like nx-fees-rate-prompt-btn"
                                        title={fxMeta.input_label_he}
                                        disabled={!canEdit || saveBusy}
                                        onClick={() => openFxDialog('inc', line, String(line.currency_code ?? 'ILS'))}
                                      >
                                        {fxMeta.prompt_link_he}
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                                <td>
                                  <select
                                    className="nx-fees-inp nx-fees-inp--table"
                                    aria-label={L.vat_mode_label_he ?? 'מצב מע"מ'}
                                    value={String(line.vat_mode ?? 'before_vat')}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      patchIncludedLineDraft(idx, { vat_mode: e.target.value });
                                      void commitIncludedLine({ ...line, vat_mode: e.target.value });
                                    }}
                                  >
                                    {vatModeOptions.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label_he}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="nx-fees-td-readonly" title={L.line_total_label_he}>
                                  {rowM?.line_total_display_he ?? '—'}
                                </td>
                                <td className="nx-fees-td-toggle">
                                  <label className="nx-fees-switch">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(line.is_active)}
                                      disabled={!canEdit}
                                      onChange={(e) => {
                                        patchIncludedLineDraft(idx, { is_active: e.target.checked });
                                        void commitIncludedLine({ ...line, is_active: e.target.checked });
                                      }}
                                    />
                                    <span className="nx-fees-switch-slider" />
                                  </label>
                                </td>
                                <td className="nx-fees-td-actions">
                                  <button
                                    type="button"
                                    className="nx-fees-icon-btn nx-fees-icon-btn--delete"
                                    title={delLbl}
                                    aria-label={delLbl}
                                    disabled={!canEdit || rowM?.deactivate_action?.enabled === false || saveBusy}
                                    onClick={() => void deleteIncludedRow(idx)}
                                  >
                                    <IconTrash />
                                  </button>
                                </td>
                              </tr>
                              {isPayroll ? (
                                <tr className="nx-fees-subrow">
                                  <td colSpan={incHeaders.length}>
                                    <div className="nx-fees-inline-pair">
                                      <div className="client-field" style={{ marginBottom: 0 }}>
                                        <div className="client-field-label">{L.payslip_count_label_he}</div>
                                        <input
                                          type="number"
                                          className="nx-fees-inp nx-fees-inp--table"
                                          disabled={!canEdit}
                                          value={line.payslip_count != null ? String(line.payslip_count) : ''}
                                          onChange={(e) => patchIncludedLineDraft(idx, { payslip_count: e.target.value })}
                                          onBlur={() => {
                                            const nextLine = {
                                              ...line,
                                              payslip_count: line.payslip_count === '' ? null : Number(line.payslip_count),
                                            };
                                            const baseline = incEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                            if (!hasLineChanged(baseline, nextLine, ['payslip_count'])) return;
                                            void commitIncludedLine(nextLine);
                                          }}
                                        />
                                      </div>
                                      <div className="client-field" style={{ marginBottom: 0 }}>
                                        <div className="client-field-label">{L.unit_price_label_he}</div>
                                        <input
                                          type="number"
                                          className="nx-fees-inp nx-fees-inp--table"
                                          disabled={!canEdit}
                                          value={line.unit_price_ils != null ? String(line.unit_price_ils) : ''}
                                          onChange={(e) => patchIncludedLineDraft(idx, { unit_price_ils: e.target.value })}
                                          onBlur={() => {
                                            const nextLine = {
                                              ...line,
                                              unit_price_ils: line.unit_price_ils === '' ? null : Number(line.unit_price_ils),
                                            };
                                            const baseline = incEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                            if (!hasLineChanged(baseline, nextLine, ['unit_price_ils'])) return;
                                            void commitIncludedLine(nextLine);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="nx-fees-modal-section" aria-labelledby="fees-modal-cust">
                <div className="nx-fees-modal-section-bar">
                  <h3 id="fees-modal-cust" className="nx-fees-modal-section-title">
                    {custEd.section_title_he}
                  </h3>
                  {canAddCust && custEd.add_button ? (
                    <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" onClick={addCustom}>
                      {custEd.add_button.label_he}
                    </button>
                  ) : null}
                </div>
                <div className="nx-fees-table-wrap">
                  <table className="nx-fees-data-table nx-fees-services-table nx-fees-services-table--custom">
                    <thead>
                      <tr>
                        {custHeaders.map((h, hi) => (
                          <th key={hi} {...(!String(h).trim() ? { 'aria-label': 'מחיקה' } : {})}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {customLines.length === 0 ? (
                        <tr>
                          <td colSpan={custHeaders.length} className="nx-fees-empty">
                            {feesTab.custom_services.empty_state_he}
                          </td>
                        </tr>
                      ) : (
                        customLines.map((line, idx) => {
                          const rowM = feesTab.custom_services.rows[idx];
                          const delLbl = rowM?.deactivate_action?.label_he ?? 'מחיקה';
                          return (
                            <tr key={String(line.line_id ?? idx)}>
                              <td>
                                <input
                                  className="nx-fees-inp nx-fees-inp--table"
                                  value={String(line.display_name_he ?? '')}
                                  disabled={!canEdit}
                                  onChange={(e) => patchCustomLineDraft(idx, { display_name_he: e.target.value })}
                                  onBlur={() => {
                                    const nextLine = { ...line, display_name_he: line.display_name_he };
                                    const baseline = custEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                    if (!hasLineChanged(baseline, nextLine, ['display_name_he'])) return;
                                    void commitCustomLine(nextLine);
                                  }}
                                />
                              </td>
                              <td>
                                <select
                                  className="nx-fees-inp nx-fees-inp--table"
                                  value={String(line.charging_type ?? 'monthly')}
                                  disabled={!canEdit}
                                  onChange={(e) => {
                                    patchCustomLineDraft(idx, { charging_type: e.target.value });
                                    void commitCustomLine({ ...line, charging_type: e.target.value });
                                  }}
                                >
                                  {feesTab.charging_type_options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label_he}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  className="nx-fees-inp nx-fees-inp--table"
                                  disabled={!canEdit}
                                  value={line.price_ils != null ? String(line.price_ils) : ''}
                                  onChange={(e) => patchCustomLineDraft(idx, { price_ils: e.target.value })}
                                  onBlur={() => {
                                    const nextLine = {
                                      ...line,
                                      price_ils: line.price_ils === '' || line.price_ils == null ? 0 : Number(line.price_ils),
                                    };
                                    const baseline = custEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                    if (!hasLineChanged(baseline, nextLine, ['price_ils'])) return;
                                    void commitCustomLine(nextLine);
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={1}
                                  className="nx-fees-inp nx-fees-inp--table"
                                  aria-label={L.quantity_label_he}
                                  disabled={!canEdit}
                                  value={line.quantity != null ? String(line.quantity) : '1'}
                                  onChange={(e) => patchCustomLineDraft(idx, { quantity: e.target.value })}
                                  onBlur={() => {
                                    const nextLine = {
                                      ...line,
                                      quantity: line.quantity === '' || line.quantity == null ? 1 : Number(line.quantity),
                                    };
                                    const baseline = custEd.rows[idx]?.persist_line as Record<string, unknown> | undefined;
                                    if (!hasLineChanged(baseline, nextLine, ['quantity'])) return;
                                    void commitCustomLine(nextLine);
                                  }}
                                />
                              </td>
                              <td>
                                <div className="nx-fees-currency-cell">
                                  <select
                                    className="nx-fees-inp nx-fees-inp--table"
                                    aria-label={L.currency_label_he}
                                    value={String(line.currency_code ?? 'ILS')}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      patchCustomLineDraft(idx, { currency_code: e.target.value });
                                      onCustomCurrencySelect(line, e.target.value);
                                    }}
                                  >
                                    {curOpts.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label_he}
                                      </option>
                                    ))}
                                  </select>
                                  {rowM?.exchange_rate_required ? (
                                    <button
                                      type="button"
                                      className="nx-fees-link-like nx-fees-rate-prompt-btn"
                                      title={fxMeta.input_label_he}
                                      disabled={!canEdit || saveBusy}
                                      onClick={() => openFxDialog('cust', line, String(line.currency_code ?? 'ILS'))}
                                    >
                                      {fxMeta.prompt_link_he}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="nx-fees-td-readonly" title={L.line_total_label_he}>
                                {rowM?.line_total_display_he ?? '—'}
                              </td>
                              <td className="nx-fees-td-toggle">
                                <label className="nx-fees-switch">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(line.is_active)}
                                    disabled={!canEdit}
                                      onChange={(e) => {
                                        patchCustomLineDraft(idx, { is_active: e.target.checked });
                                        void commitCustomLine({ ...line, is_active: e.target.checked });
                                      }}
                                  />
                                  <span className="nx-fees-switch-slider" />
                                </label>
                              </td>
                              <td className="nx-fees-td-actions">
                                <button
                                  type="button"
                                  className="nx-fees-icon-btn nx-fees-icon-btn--delete"
                                  title={delLbl}
                                  aria-label={delLbl}
                                  disabled={!canEdit || rowM?.deactivate_action?.enabled === false || saveBusy}
                                  onClick={() => void deleteCustomRow(idx)}
                                >
                                  <IconTrash />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="nx-fees-modal-section" aria-labelledby="fees-modal-discount">
                <h3 id="fees-modal-discount" className="nx-fees-modal-section-title">
                  {editModalSectionTitle(feesTab, 'fees_discount')}
                </h3>
                <div className="nx-fees-side-fields nx-fees-discount-fields">
                  <DiscountSectionFields feesTab={feesTab} draft={draft} canEdit={canEdit} onDraftChange={onDraftChange} />
                </div>
              </section>

              <section className="nx-fees-modal-section" aria-labelledby="fees-modal-renewal">
                <h3 id="fees-modal-renewal" className="nx-fees-modal-section-title">
                  {feesTab.renewal.card_title_he}
                </h3>
                <RenewalSideFieldsRow feesTab={feesTab} draft={draft} canEdit={canEdit} onDraftChange={onDraftChange} />
              </section>

              {saveError ? <p className="nx-fees-save-error">{saveError}</p> : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                disabled={saveBusy}
                onClick={() => setFeesEditOpen(false)}
              >
                סגירה
              </button>
              <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={saveBusy} onClick={() => void handleSave()}>
                {saveBusy ? 'שומר…' : 'שמירה'}
              </button>
            </div>
          </div>
        </div>
          {fxDialog ? (
            <div
              className="nx-modal-overlay nx-fees-fx-overlay"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget && !saveBusy) setFxDialog(null);
              }}
            >
              <div
                className="nx-modal nx-fees-fx-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="nx-fees-fx-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="nx-modal-header">
                  <div className="nx-modal-title-wrap">
                    <h2 id="nx-fees-fx-title" className="nx-modal-title nx-fees-fx-dialog-title">
                      {fxMeta.title_template_he.replace(
                        '{currency}',
                        curOpts.find((o) => o.value === fxDialog.currencyCode)?.label_he ?? fxDialog.currencyCode
                      )}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="nx-modal-close"
                    aria-label={fxMeta.cancel_he}
                    disabled={saveBusy}
                    onClick={() => setFxDialog(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="nx-modal-body">
                  <div className="client-field">
                    <div className="client-field-label">{fxMeta.input_label_he}</div>
                    <input
                      type="number"
                      className="nx-fees-inp"
                      value={fxRateDraft}
                      onChange={(e) => setFxRateDraft(e.target.value)}
                      disabled={saveBusy}
                      step="any"
                      min={0}
                    />
                  </div>
                </div>
                <div className="nx-modal-footer nx-tax-nested-modal-footer">
                  <button
                    type="button"
                    className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                    disabled={saveBusy}
                    onClick={() => setFxDialog(null)}
                  >
                    {fxMeta.cancel_he}
                  </button>
                  <button
                    type="button"
                    className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                    disabled={saveBusy}
                    onClick={() => void confirmFxRate()}
                  >
                    {fxMeta.confirm_he}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
