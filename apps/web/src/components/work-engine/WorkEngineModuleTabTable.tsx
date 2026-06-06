/**
 * INC-8 — generic Work Engine module tab table (render-only).
 * Columns, rows, and summary come from backend aggregate.table_model / summary.
 */

export type WorkEngineModuleTabColumn = {
  key: string;
  label: string;
  type: 'text' | 'money_reference' | 'date' | 'status';
};

export type WorkEngineModuleTabTableModel = {
  columns: WorkEngineModuleTabColumn[];
  rows: Array<Record<string, string | number | null>>;
  empty_state?: {
    visible: boolean;
    title: string;
    description: string | null;
  };
};

export type WorkEngineModuleTabSummary = {
  rows_count: number;
  sum_paid_reference: number;
  avg_paid_reference: number;
  currency: string;
};

function formatCell(value: string | number | null, type: WorkEngineModuleTabColumn['type']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money_reference' && typeof value === 'number') {
    return value.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return String(value);
}

export function WorkEngineModuleTabTable(props: {
  table: WorkEngineModuleTabTableModel;
  summary: WorkEngineModuleTabSummary;
}) {
  const { table, summary } = props;
  const columns = table?.columns ?? [];
  const rows = table?.rows ?? [];
  const empty = table?.empty_state?.visible === true && rows.length === 0;

  return (
    <div className="nx-we-module-tab">
      <div className="nx-we-module-tab__table-wrap">
        <table className="nx-we-module-tab__table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={columns.length || 1} className="nx-we-module-tab__empty">
                  <strong>{table?.empty_state?.title ?? ''}</strong>
                  {table?.empty_state?.description ? (
                    <p>{table.empty_state.description}</p>
                  ) : null}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={String(row.income_document_id ?? idx)}>
                  {columns.map((col) => (
                    <td key={col.key} data-col-type={col.type}>
                      {formatCell(row[col.key] as string | number | null, col.type)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <footer className="nx-we-module-tab__summary" aria-label="סיכום טבלה">
        <span>
          שורות: <strong>{summary?.rows_count ?? 0}</strong>
        </span>
        <span>
          סה״כ שולם (הפניה): <strong>{formatCell(summary?.sum_paid_reference ?? 0, 'money_reference')}</strong>{' '}
          {summary?.currency ?? 'ILS'}
        </span>
        <span>
          ממוצע שולם (הפניה): <strong>{formatCell(summary?.avg_paid_reference ?? 0, 'money_reference')}</strong>{' '}
          {summary?.currency ?? 'ILS'}
        </span>
      </footer>
    </div>
  );
}
