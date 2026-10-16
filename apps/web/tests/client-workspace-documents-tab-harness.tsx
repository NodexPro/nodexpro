/**
 * Visual harness: real ClientWorkspaceModal on מסמכים with a
 * representative client_documents_tab aggregate.
 */
import '../src/styles/nx-modal.css';
import '../src/templates/template-1/tokens.css';
import '../src/styles/nx-client-operations-shell.css';
import '../src/styles/nx-client-operations-spreadsheet.css';
import { createRoot } from 'react-dom/client';
import {
  ClientWorkspaceModal,
  buildPlaceholderClientCaseFromRegistryRow,
} from '../src/components/ClientWorkspacePanel';
import type { ClientDocumentsTabModel } from '../src/components/client-documents-tab-types';

const workspace = buildPlaceholderClientCaseFromRegistryRow({
  client_id: 'documents-harness-client',
  client_name: 'חברת בדיקה בע״מ',
  tax_id: '512345678',
  business_type: 'עוסק מורשה',
  payroll_flag: true,
  material_brought_flag: false,
  vat_status: 'מורשה',
  income_tax_advance_status: null,
  national_insurance_status: null,
  national_insurance_deductions_status: null,
  income_tax_deductions_status: null,
  assigned_handler_user_id: null,
  vat_due_registry_display_he: '15 לחודש',
});

const documentsTab: ClientDocumentsTabModel = {
  tab_key: 'client_documents',
  read_model_version: 1,
  permissions: { can_view: true, can_edit: true },
  ui: {
    add_folder_label_he: 'תיקייה',
    add_document_label_he: 'מסמך',
    empty_folders_state_he: 'אין תיקיות עדיין',
    empty_documents_state_he: 'אין מסמכים בתיקייה',
    tab_title_he: 'מסמכים',
  },
  folders_grid: {
    columns_per_row: 3,
    folders: [
      {
        folder_id: 'folder-vat',
        name_he: 'מע״מ',
        document_count: 2,
        last_updated_at: '2026-10-01T00:00:00.000Z',
        last_updated_display_he: 'עודכן 01/10/2026',
        is_system: true,
        brand_variant: 'primary',
        actions: { can_open: true, can_rename: false, can_archive_or_delete: false },
      },
      {
        folder_id: 'folder-income',
        name_he: 'מס הכנסה',
        document_count: 1,
        last_updated_at: '2026-09-12T00:00:00.000Z',
        last_updated_display_he: 'עודכן 12/09/2026',
        is_system: true,
        brand_variant: 'secondary',
        actions: { can_open: true, can_rename: true, can_archive_or_delete: false },
      },
      {
        folder_id: 'folder-other',
        name_he: 'כללי',
        document_count: 0,
        last_updated_at: null,
        last_updated_display_he: '—',
        is_system: false,
        brand_variant: 'neutral',
        actions: { can_open: true, can_rename: true, can_archive_or_delete: true },
      },
    ],
  },
  open_folder: {
    folder_id: 'folder-vat',
    folder_name_he: 'מע״מ',
    documents: [
      {
        document_id: 'doc-1',
        file_asset_id: 'asset-1',
        file_name_he: 'vat-2026-09.pdf',
        display_label_he: 'דיווח מע״מ ספטמבר',
        uploaded_display_he: 'הועלה 02/10/2026',
        file_open_allowed: true,
        actions: { can_view: true, can_delete: true },
      },
      {
        document_id: 'doc-2',
        file_asset_id: 'asset-2',
        file_name_he: 'vat-confirm.pdf',
        display_label_he: 'אישור הגשה',
        uploaded_display_he: 'הועלה 03/10/2026',
        file_open_allowed: true,
        actions: { can_view: true, can_delete: false },
      },
    ],
  },
  file_open_path_template: '/files/{file_asset_id}',
};

workspace.client_documents_tab = documentsTab;

createRoot(document.getElementById('root')!).render(
  <div className="t1-appShell t1-appShell--client-operations" style={{ display: 'flex', minHeight: '100vh' }}>
    <aside className="t1-sidebar" style={{ width: 64, flex: '0 0 64px' }}>
      ניווט
    </aside>
    <div className="t1-shellColumn" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <header className="nx-co-app-header">ניהול לקוחות</header>
      <main className="t1-pageMain">
        <div>
          <div className="nx-co-sheet">
            <ClientWorkspaceModal
              open
              workspace={workspace}
              loading={false}
              error=""
              onClose={() => undefined}
            />
          </div>
        </div>
      </main>
    </div>
  </div>,
);

function selectDocumentsTab(): void {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) =>
    el.textContent?.includes('מסמכים'),
  );
  if (!tab) {
    requestAnimationFrame(selectDocumentsTab);
    return;
  }
  (tab as HTMLButtonElement).click();
  dumpDocumentsOverlay();
}

function dumpDocumentsOverlay(): void {
  const panel = document.querySelector('.nx-cdocs-folder-panel') as HTMLElement | null;
  const close = document.querySelector('.nx-cdocs-folder-panel-close') as HTMLElement | null;
  const workspace = document.querySelector('.nx-modal.nx-workspace-modal') as HTMLElement | null;
  if (!panel || !close || !workspace) {
    requestAnimationFrame(dumpDocumentsOverlay);
    return;
  }
  const pr = panel.getBoundingClientRect();
  const cr = close.getBoundingClientRect();
  const wr = workspace.getBoundingClientRect();
  const pcs = getComputedStyle(panel);
  const name = document.querySelector('.nx-cdocs-folder-name') as HTMLElement | null;
  const count = document.querySelector('.nx-cdocs-folder-count') as HTMLElement | null;
  const date = document.querySelector('.nx-cdocs-folder-updated') as HTMLElement | null;
  const pre = document.getElementById('nx-layout-dump');
  if (pre) {
    pre.textContent = JSON.stringify({
      panel: {
        w: pr.width,
        h: pr.height,
        x: pr.x,
        y: pr.y,
        font: pcs.fontFamily,
        backgroundImage: pcs.backgroundImage,
        overflowX: pcs.overflowX,
      },
      close: { w: cr.width, h: cr.height, x: cr.x, y: cr.y },
      workspace: { w: wr.width, h: wr.height, x: wr.x, y: wr.y, font: getComputedStyle(workspace).fontFamily },
      folderNameFont: name ? getComputedStyle(name).fontFamily : '',
      folderCountFont: count ? getComputedStyle(count).fontFamily : '',
      folderDateFont: date ? getComputedStyle(date).fontFamily : '',
      addLabel: document.querySelector('.nx-cdocs-folder-panel-head-actions .nx-btn-primary')?.textContent?.trim() ?? '',
      footerClose: Array.from(panel.querySelectorAll('.nx-btn')).some((b) => b.textContent?.trim() === 'סגירה'),
    });
  }
}

requestAnimationFrame(selectDocumentsTab);
