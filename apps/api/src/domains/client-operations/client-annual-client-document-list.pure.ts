/**
 * Client-facing document list for annual report / capital declaration.
 * PDF content is derived from the current versioned checklist selection,
 * never from a static template. Internal codes, accountant notes and
 * statuses stay out of the client PDF.
 */

export type ClientDocumentListItemInput = {
  row_id: string;
  source_type: 'system' | 'custom';
  system_key: string | null;
  document_name_he: string;
  description_he: string | null;
  include_in_client_list: boolean;
  client_facing_name_he: string | null;
  client_facing_description_he: string | null;
  received?: boolean;
  row_note?: string | null;
  status?: string | null;
};

export type ClientFacingDocumentListItem = {
  row_id: string;
  internal_name: string;
  client_facing_name: string;
  client_facing_description: string | null;
  include_in_client_list: boolean;
  source_type: 'system' | 'custom';
};

export type ClientDocumentListPdfSnapshot = {
  version: 1;
  tab_scope: 'annual_report' | 'capital_declaration';
  office_name: string;
  client_name: string;
  period_label: string;
  generated_at: string;
  items: Array<{
    client_facing_name: string;
    client_facing_description: string | null;
  }>;
};

export function internalDocumentListName(row: ClientDocumentListItemInput): string {
  if (row.system_key && String(row.system_key).trim()) return String(row.system_key).trim();
  return `custom:${row.row_id}`;
}

export function clientFacingDocumentListName(row: ClientDocumentListItemInput): string {
  const explicit = String(row.client_facing_name_he ?? '').trim();
  if (explicit) return explicit;
  return String(row.document_name_he ?? '').trim();
}

export function clientFacingDocumentListDescription(row: ClientDocumentListItemInput): string | null {
  const explicit = String(row.client_facing_description_he ?? '').trim();
  if (explicit) return explicit;
  const fallback = String(row.description_he ?? '').trim();
  return fallback || null;
}

export function projectClientDocumentListItems(
  rows: readonly ClientDocumentListItemInput[],
): ClientFacingDocumentListItem[] {
  return rows.map((row) => ({
    row_id: row.row_id,
    internal_name: internalDocumentListName(row),
    client_facing_name: clientFacingDocumentListName(row),
    client_facing_description: clientFacingDocumentListDescription(row),
    include_in_client_list: Boolean(row.include_in_client_list),
    source_type: row.source_type,
  }));
}

export function selectedClientDocumentListItems(
  rows: readonly ClientFacingDocumentListItem[],
): ClientFacingDocumentListItem[] {
  return rows.filter((row) => row.include_in_client_list && row.client_facing_name);
}

/** PDF include flags only — never reorders, renames, or changes received/status. */
export function overlayClientListSelection(
  items: readonly ClientFacingDocumentListItem[],
  selectedRowIds: readonly string[],
): ClientFacingDocumentListItem[] {
  const selected = new Set(selectedRowIds.map((id) => String(id)));
  return items.map((item) => ({
    ...item,
    include_in_client_list: selected.has(item.row_id),
  }));
}

export function defaultIncludeInClientList(input: {
  sourceType: 'system' | 'custom';
  tabScope?: 'annual_report' | 'capital_declaration';
  required?: boolean | null;
}): boolean {
  if (input.sourceType === 'custom') return true;
  if (input.tabScope === 'capital_declaration') return Boolean(input.required);
  return false;
}

export function buildClientDocumentListPdfSnapshot(input: {
  tabScope: 'annual_report' | 'capital_declaration';
  officeName: string;
  clientName: string;
  periodLabel: string;
  generatedAt: string;
  items: readonly ClientFacingDocumentListItem[];
}): ClientDocumentListPdfSnapshot {
  return {
    version: 1,
    tab_scope: input.tabScope,
    office_name: input.officeName,
    client_name: input.clientName,
    period_label: input.periodLabel,
    generated_at: input.generatedAt,
    items: selectedClientDocumentListItems(input.items).map((item) => ({
      client_facing_name: item.client_facing_name,
      client_facing_description: item.client_facing_description,
    })),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildClientDocumentListPdfHtml(snapshot: ClientDocumentListPdfSnapshot): string {
  const title = 'רשימת מסמכים ללקוח';
  const itemsHtml = snapshot.items.length
    ? snapshot.items
        .map((item) => {
          const desc = item.client_facing_description
            ? `<div class="desc">${escapeHtml(item.client_facing_description)}</div>`
            : '';
          return `<li><div class="name">${escapeHtml(item.client_facing_name)}</div>${desc}</li>`;
        })
        .join('')
    : '<li>אין מסמכים שנבחרו לרשימת הלקוח</li>';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  html, body { direction: rtl; text-align: right; }
  body {
    font-family: Arial, "Noto Sans Hebrew", "Segoe UI", sans-serif;
    color: #111111;
    margin: 0;
    padding: 8px 4px;
  }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .meta { font-size: 14px; margin: 0 0 6px; }
  ol { padding: 0 22px 0 0; margin: 18px 0 0; }
  li { margin: 0 0 12px; }
  .name { font-size: 15px; font-weight: 700; }
  .desc { font-size: 13px; font-weight: 400; margin-top: 4px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">משרד: ${escapeHtml(snapshot.office_name)}</p>
  <p class="meta">לקוח: ${escapeHtml(snapshot.client_name)}</p>
  <p class="meta">${escapeHtml(snapshot.period_label)}</p>
  <ol>${itemsHtml}</ol>
</body>
</html>`;
}

export function clientDocumentListPdfContainsForbiddenClientContent(html: string): boolean {
  return (
    html.includes('internal_name') ||
    html.includes('system_key') ||
    html.includes('row_note') ||
    html.includes('status_label')
  );
}
