import type { IncomeIssuedDocumentsTableRow, IncomeTableModel } from '../../api/income';
import { IncomeDataTable } from './IncomeDataTable';

const ACTION_LABELS: Record<string, string> = {
  download_pdf: 'הורדת PDF',
  retry_income_document_accounting_posting: 'ניסיון חוזר חשבונאות',
  retry_income_document_pdf_render: 'ניסיון חוזר PDF',
};

type Props = {
  model: IncomeTableModel<IncomeIssuedDocumentsTableRow>;
  busy: boolean;
  onRowAction: (row: IncomeIssuedDocumentsTableRow, action: string) => void;
};

export function IncomeDocumentsTable({ model, busy, onRowAction }: Props) {
  return (
    <IncomeDataTable
      title="מסמכים שהופקו"
      panelId="income-panel-documents"
      columns={model.columns}
      rows={model.rows}
      emptyState={model.empty_state}
      rowKey={(r) => r.document_id}
      renderCell={(row, key) => {
        if (key === 'accounting_status_label' || key === 'pdf_status_label') {
          const v = (row as unknown as Record<string, unknown>)[key];
          return v != null ? String(v) : '—';
        }
        const v = (row as unknown as Record<string, unknown>)[key];
        if (v == null || v === '') return '—';
        return String(v);
      }}
      renderActions={(row) => (
        <div className="nx-income-row-actions">
          {row.allowed_actions.map((action) => (
            <button
              key={action}
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={busy}
              onClick={() => onRowAction(row, action)}
            >
              {ACTION_LABELS[action] ?? action}
            </button>
          ))}
        </div>
      )}
    />
  );
}
