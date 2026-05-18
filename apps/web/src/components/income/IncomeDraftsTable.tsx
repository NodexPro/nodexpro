import type { IncomeDraftsTableRow, IncomeTableModel } from '../../api/income';
import { IncomeDataTable } from './IncomeDataTable';

const ACTION_LABELS: Record<string, string> = {
  update_income_document_draft: 'עריכה',
  cancel_income_document_draft: 'ביטול',
  issue_income_document: 'הפקה',
};

type Props = {
  model: IncomeTableModel<IncomeDraftsTableRow>;
  busy: boolean;
  onRowAction: (row: IncomeDraftsTableRow, action: string) => void;
};

export function IncomeDraftsTable({ model, busy, onRowAction }: Props) {
  return (
    <IncomeDataTable
      title="טיוטות"
      panelId="income-panel-drafts"
      columns={model.columns}
      rows={model.rows}
      emptyState={model.empty_state}
      rowKey={(r) => r.draft_id}
      renderCell={(row, key) => {
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
