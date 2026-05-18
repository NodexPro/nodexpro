import type { IncomeCustomersTableRow, IncomeTableModel } from '../../api/income';
import { IncomeDataTable } from './IncomeDataTable';

type Props = {
  model: IncomeTableModel<IncomeCustomersTableRow>;
  canCreate: boolean;
  busy: boolean;
  onCreateCustomer: () => void;
};

export function IncomeCustomersTable({ model, canCreate, busy, onCreateCustomer }: Props) {
  return (
    <IncomeDataTable
      title="לקוחות"
      panelId="income-panel-customers"
      columns={model.columns}
      rows={model.rows}
      emptyState={model.empty_state}
      rowKey={(r) => r.customer_id}
      renderCell={(row, key) => {
        const v = (row as unknown as Record<string, unknown>)[key];
        if (v == null || v === '') return '—';
        if (typeof v === 'boolean') return v ? 'כן' : 'לא';
        return String(v);
      }}
      headerAction={
        canCreate ? (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onCreateCustomer}>
            לקוח חדש
          </button>
        ) : null
      }
    />
  );
}
