/**
 * Visual harness: real ClientWorkspaceModal on the מיסים tab with a
 * representative tax_tab aggregate shape (labels/values as the backend sends).
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
import type { TaxTabSectionReadModel, TaxTabWorkspaceResponse } from '../src/components/tax-tab-types';

function section(
  partial: Pick<TaxTabSectionReadModel, 'section_key' | 'title_he' | 'display_rows'> &
    Partial<Pick<TaxTabSectionReadModel, 'edit' | 'payment_panel'>>,
): TaxTabSectionReadModel {
  return {
    visible: true,
    edit: {
      enabled: true,
      button_label_he: 'עריכה',
      command: 'update_tax_vat_registration',
      ...partial.edit,
    },
    edit_model: { fields: [], values: {} },
    ...partial,
  };
}

const workspace = buildPlaceholderClientCaseFromRegistryRow({
  client_id: 'taxes-harness-client',
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

const taxTab: TaxTabWorkspaceResponse = {
  read_model_version: 1,
  ui: workspace.tax_settings.ui,
  baseline: { settings: workspace.tax_settings.settings },
  header: {
    title_he: 'מיסים',
    client_tax_id: '512345678',
    client_display_name: 'חברת בדיקה בע״מ',
    summary_rows: [
      { row_key: 'client_tax_id', label_he: 'ח.פ / ת.ז', value_he: '512345678' },
      { row_key: 'client_display_name', label_he: 'שם לקוח', value_he: 'חברת בדיקה בע״מ' },
      { row_key: 'vat_divuach_next', label_he: 'יעד דיווח מע״מ', value_he: '15/11/2026' },
      { row_key: 'vat_registry', label_he: 'רישום יעד מע״מ', value_he: '15 לחודש' },
    ],
  },
  sections: [
    section({
      section_key: 'vat_registration',
      title_he: 'רישום מע״מ',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_vat_registration' },
      display_rows: [
        { row_key: 'vat_type', label_he: 'מע״מ', value_he: 'מורשה' },
        { row_key: 'vat_frequency', label_he: 'תדירות מע״מ', value_he: 'חודשי' },
        { row_key: 'vat_due_type', label_he: 'יום יעד למע״מ', value_he: '15 לחודש' },
      ],
    }),
    section({
      section_key: 'income_tax_advances',
      title_he: 'מקדמות מס הכנסה',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_income_advances' },
      display_rows: [
        { row_key: 'advance_selection', label_he: 'מקדמות מס הכנסה', value_he: 'כן' },
        { row_key: 'advance_percent', label_he: 'אחוז', value_he: '10' },
        { row_key: 'advance_frequency', label_he: 'תדירות דיווח', value_he: 'חודשי' },
      ],
    }),
    section({
      section_key: 'income_tax_deductions',
      title_he: 'מס הכנסה ניכויים',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_income_deductions' },
      display_rows: [
        { row_key: 'ded_selection', label_he: 'מס הכנסה ניכויים', value_he: 'לא' },
      ],
    }),
    section({
      section_key: 'national_insurance',
      title_he: 'ביטוח לאומי',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_national_insurance' },
      display_rows: [
        { row_key: 'ni_type', label_he: 'ביטוח לאומי עצמאי', value_he: 'לא' },
        {
          row_key: 'ni_deductions_registry',
          label_he: 'תיק ניכויים בביטוח לאומי',
          value_he: '—',
          tone: 'not_relevant',
        },
      ],
    }),
    section({
      section_key: 'vat_payment',
      title_he: 'תשלום מע״מ',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_vat_payment' },
      display_rows: [{ row_key: 'vat_pay_method', label_he: 'איך משלם מע״מ', value_he: 'העברה בנקאית' }],
    }),
    section({
      section_key: 'income_tax_payment',
      title_he: 'תשלום מס הכנסה',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_income_tax_payment' },
      display_rows: [{ row_key: 'it_pay_method', label_he: 'איך משלם מס הכנסה', value_he: 'העברה בנקאית' }],
    }),
    section({
      section_key: 'notes',
      title_he: 'הערות',
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_notes' },
      display_rows: [{ row_key: 'notes', label_he: 'הערות', value_he: '—', tone: 'muted' }],
    }),
  ],
};

workspace.tax_tab = taxTab;

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

function selectTaxesTab(): void {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) => el.textContent?.includes('מיסים'));
  if (!tab) {
    requestAnimationFrame(selectTaxesTab);
    return;
  }
  (tab as HTMLButtonElement).click();
  requestAnimationFrame(openVatEditorThenDump);
}

function openVatEditorThenDump(): void {
  const dump = new URLSearchParams(location.search).get('dump');
  if (dump !== 'vat-editor') return;
  const modal = document.querySelector('.nx-modal.nx-workspace-modal .nx-modal-overlay .nx-modal');
  if (!modal) {
    const edit = Array.from(document.querySelectorAll('.nx-ws-taxes .nx-taxes-section-edit-btn'))[0] as
      | HTMLButtonElement
      | undefined;
    if (!edit) {
      requestAnimationFrame(openVatEditorThenDump);
      return;
    }
    edit.click();
    requestAnimationFrame(openVatEditorThenDump);
    return;
  }
  const header = modal.querySelector('.nx-modal-header') as HTMLElement | null;
  const close = modal.querySelector('.nx-modal-close') as HTMLElement | null;
  const helper = modal.querySelector('.nx-modal-body p') as HTMLElement | null;
  const label = modal.querySelector('.nx-modal-body label') as HTMLElement | null;
  const hr = header?.getBoundingClientRect();
  const cr = close?.getBoundingClientRect();
  const mr = (modal as HTMLElement).getBoundingClientRect();
  const pre = document.getElementById('nx-layout-dump');
  if (pre) {
    pre.textContent = JSON.stringify({
      helperColor: helper ? getComputedStyle(helper).color : '',
      labelColor: label ? getComputedStyle(label).color : '',
      header: header && hr ? { w: hr.width, h: hr.height, x: hr.x, y: hr.y } : null,
      close: close && cr ? { w: cr.width, h: cr.height, x: cr.x, y: cr.y } : null,
      modal: { w: mr.width, h: mr.height, x: mr.x, y: mr.y },
      workspaceClose: (() => {
        const el = document.querySelector('.nx-workspace-close') as HTMLElement | null;
        const r = el?.getBoundingClientRect();
        return el && r ? { w: r.width, h: r.height, x: r.x, y: r.y } : null;
      })(),
    });
  }
}

requestAnimationFrame(selectTaxesTab);
