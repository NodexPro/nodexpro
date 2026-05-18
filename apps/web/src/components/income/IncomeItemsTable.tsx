import type { IncomeItemsTableRow, IncomeTableModel } from '../../api/income';
import { IncomeDataTable } from './IncomeDataTable';

type Props = {
  model: IncomeTableModel<IncomeItemsTableRow>;
  canCreate: boolean;
  busy: boolean;
  onCreateItem: () => void;
};

export function IncomeItemsTable({ model, canCreate, busy, onCreateItem }: Props) {
  return (
    <IncomeDataTable
      title="פריטים"
      panelId="income-panel-items"
      columns={model.columns}
      rows={model.rows}
      emptyState={model.empty_state}
      rowKey={(r) => r.item_id}
      renderCell={(row, key) => {
        const v = (row as unknown as Record<string, unknown>)[key];
        if (v == null || v === '') return '—';
        if (typeof v === 'boolean') return v ? 'פעיל' : 'לא פעיל';
        return String(v);
      }}
      headerAction={
        canCreate ? (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onCreateItem}>
            פריט חדש
          </button>
        ) : null
      }
    />
  );
}
