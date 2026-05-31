import type { ReactNode } from 'react';
import type { IncomeTableColumn } from '../../api/income';
import { EmptyState } from '../../templates/template-1/components/EmptyState';

type Props<T> = {
  title: string;
  panelId: string;
  columns: IncomeTableColumn[];
  rows: T[];
  emptyState: { visible: boolean; title: string; description: string | null };
  rowKey: (row: T) => string;
  renderCell: (row: T, columnKey: string) => ReactNode;
  renderActions?: (row: T) => ReactNode;
  headerAction?: ReactNode;
};

export function IncomeDataTable<T>({
  title,
  panelId,
  columns,
  rows,
  emptyState,
  rowKey,
  renderCell,
  renderActions,
  headerAction,
}: Props<T>) {
  return (
    <section className="nx-income-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
      <div className="nx-income-panel__head">
        <h2 className="nx-income-panel__title nx-subsection-title" id={`${panelId}-title`}>
          {title}
        </h2>
        {headerAction}
      </div>
      {emptyState.visible && rows.length === 0 ? (
        <div style={{ padding: 24 }}>
          <EmptyState title={emptyState.title} description={emptyState.description ?? undefined} />
        </div>
      ) : (
        <div className="nx-income-table-wrap">
          <table className="nx-income-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
                {renderActions ? <th scope="col">פעולות</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.key}>{renderCell(row, c.key)}</td>
                  ))}
                  {renderActions ? <td>{renderActions(row)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
