import type { WorkEngineInvoiceRetainerChildDocumentHistoryRow } from '../../income/income-workspace-types';

type Props = {
  rows: WorkEngineInvoiceRetainerChildDocumentHistoryRow[];
};

export function WorkEngineInvoiceRetainerChildDocumentsHistory({ rows }: Props) {
  return (
    <section className="nx-we-retainer-child-history">
      <h3 className="nx-we-retainer-child-history__title">מסמכים שנוצרו</h3>
      {rows.length === 0 ? (
        <p className="nx-we-retainer-child-history__empty">טרם נוצרו מסמכים מריטיינר זה.</p>
      ) : (
        <div className="nx-we-retainer-child-history__table-wrap">
          <table className="nx-we-retainer-child-history__table">
            <thead>
              <tr>
                <th scope="col">מחזור</th>
                <th scope="col">תאריך מסמך</th>
                <th scope="col">תאריך טיוטה</th>
                <th scope="col">סטטוס</th>
                <th scope="col">טיוטה / מסמך</th>
                <th scope="col">שגיאה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cycle_id} data-status={row.status}>
                  <td>{row.cycle_number}</td>
                  <td>{row.scheduled_document_date_display}</td>
                  <td>{row.draft_creation_date_display}</td>
                  <td>
                    <span className="nx-we-retainer-child-history__status">{row.status_label}</span>
                  </td>
                  <td>
                    {row.generated_document_reference_display ? (
                      <span>{row.generated_document_reference_display}</span>
                    ) : row.generated_draft_reference_display ? (
                      <span>{row.generated_draft_reference_display}</span>
                    ) : (
                      <span className="nx-we-retainer-child-history__muted">—</span>
                    )}
                  </td>
                  <td>
                    {row.failure_reason ? (
                      <span className="nx-we-retainer-child-history__failure">{row.failure_reason}</span>
                    ) : (
                      <span className="nx-we-retainer-child-history__muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
