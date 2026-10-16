/**
 * Visual harness: real ClientWorkspaceModal on הגדרות הנה״ח with a
 * representative accounting aggregate (labels/values as the backend sends).
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
import type { ClientBusinessProfileSectionResponse } from '../src/components/ClientBusinessProfileTab';
import type { AccountingTabResponse } from '../src/components/ClientAccountingSettingsTab';
import type { AnnualTabModel } from '../src/components/annual-tab-types';

const workspace = buildPlaceholderClientCaseFromRegistryRow({
  client_id: 'accounting-harness-client',
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

const accounting: ClientBusinessProfileSectionResponse = {
  section_key: 'business_profile',
  section_label: 'פרופיל עסקי',
  permissions: { can_view_business_profile: true, can_edit_business_profile: true },
  version: 1,
  fields: [
    {
      key: 'business_domain',
      label: 'תחום עיסוק',
      type: 'text',
      value: 'ייעוץ מס',
      required: false,
      editable: true,
      visible: true,
      group_key: 'business_scope',
      group_label: 'תחום העסק',
      group_order: 1,
      row_order: 1,
    },
    {
      key: 'business_activity_description',
      label: 'תיאור קצר של הפעילות',
      type: 'textarea',
      value: null,
      required: false,
      editable: true,
      visible: true,
      group_key: 'business_scope',
      group_label: 'תחום העסק',
      group_order: 1,
      row_order: 2,
    },
    {
      key: 'business_operation_mode',
      label: 'אופן פעילות עיקרי',
      type: 'enum_single',
      value: 'services',
      options: [{ value: 'services', label: 'שירותים' }],
      required: false,
      editable: true,
      visible: true,
      group_key: 'business_scope',
      group_label: 'תחום העסק',
      group_order: 1,
      row_order: 3,
    },
    {
      key: 'primary_customer_type',
      label: 'קהל עיקרי',
      type: 'enum_single',
      value: 'business',
      options: [{ value: 'business', label: 'עסקי' }],
      required: false,
      editable: true,
      visible: true,
      group_key: 'business_scope',
      group_label: 'תחום העסק',
      group_order: 1,
      row_order: 4,
    },
    {
      key: 'business_address',
      label: 'כתובת עסקי',
      type: 'text',
      value: 'הרצל 10, תל אביב',
      required: false,
      editable: true,
      visible: true,
      group_key: 'address',
      group_label: 'כתובת',
      group_order: 2,
      row_order: 1,
    },
    {
      key: 'private_address',
      label: 'כתובת פרטי',
      type: 'text',
      value: null,
      required: false,
      editable: true,
      visible: true,
      group_key: 'address',
      group_label: 'כתובת',
      group_order: 2,
      row_order: 2,
    },
    {
      key: 'is_seasonal_business',
      label: 'עסק עונתי',
      type: 'boolean',
      value: false,
      options: [
        { value: true, label: 'כן' },
        { value: false, label: 'לא' },
      ],
      required: false,
      editable: true,
      visible: false,
      group_key: 'general_info',
      group_label: 'מידע כללי',
      group_order: 3,
      row_order: 1,
    },
    {
      key: 'peak_months',
      label: 'חודשי עומס',
      type: 'multi_enum',
      value: [],
      options: [{ value: 1, label: 'ינואר' }],
      required: false,
      editable: true,
      visible: true,
      group_key: 'general_info',
      group_label: 'מידע כללי',
      group_order: 3,
      row_order: 1,
    },
    {
      key: 'business_open_date',
      label: 'פתיחת עסק',
      type: 'date',
      value: '2019-03-01',
      required: false,
      editable: true,
      visible: true,
      group_key: 'general_info',
      group_label: 'מידע כללי',
      group_order: 3,
      row_order: 2,
    },
    {
      key: 'business_close_date',
      label: 'סגירת עסק',
      type: 'date',
      value: null,
      required: false,
      editable: true,
      visible: true,
      group_key: 'general_info',
      group_label: 'מידע כללי',
      group_order: 3,
      row_order: 3,
    },
  ],
};

const accountingTab: AccountingTabResponse = {
  tab_key: 'accounting_settings',
  tab_label: 'הגדרות הנה״ח',
  layout: { type: 'grid', columns: 2 },
  blocks: [
    {
      block_key: 'income',
      block_label: 'הכנסות',
      summary_text: 'ייעוץ חודשי',
      summary_primary_rows: ['ייעוץ חודשי'],
      summary_empty_state_text: 'לא הוגדר',
      summary_secondary_empty_message: null,
      summary_items: [
        { label: 'תוכנה', value: 'חשבשבת', display: 'text' },
        { label: 'קוד משתמש', value: 'demo', display: 'text' },
      ],
      can_edit: true,
      edit_action: { type: 'open_modal', modal_key: 'accounting_settings_income' },
      version: 1,
    },
    {
      block_key: 'expense_management',
      block_label: 'הוצאות',
      summary_text: '',
      summary_primary_rows: [],
      summary_empty_state_text: 'לא הוגדר',
      summary_secondary_empty_message: null,
      summary_items: [],
      can_edit: true,
      edit_action: { type: 'open_modal', modal_key: 'accounting_settings_expense_management' },
      version: 1,
      expense_management_zones: {
        access: [
          { field_key: 'expense_software_name', label: 'שם תוכנת הוצאות', value: 'לא הוגדר', visible: true },
          { field_key: 'expense_software_username', label: 'קוד משתמש למערכת הוצאות', value: 'לא הוגדר', visible: true },
        ],
        main_column: [
          { field_key: 'expense_delivery_method', label: 'קבלת הוצאות', value: 'מייל', visible: true },
          { field_key: 'expense_management_notes', label: 'הערות על ניהול הוצאות', value: 'לא הוגדר', visible: true },
        ],
      },
    },
    {
      block_key: 'expenses',
      block_label: 'הוצאות קבועות',
      summary_text: 'שכירות ₪3,000',
      summary_primary_rows: ['שכירות ₪3,000'],
      summary_empty_state_text: 'לא הוגדר',
      summary_secondary_empty_message: null,
      summary_items: [{ label: 'רכב', value: '45%', display: 'text' }],
      can_edit: true,
      edit_action: { type: 'open_modal', modal_key: 'accounting_settings_expenses' },
      version: 1,
    },
    {
      block_key: 'vehicles',
      block_label: 'רכבים',
      summary_text: '',
      summary_primary_rows: [],
      summary_empty_state_text: 'לא הוגדר',
      summary_secondary_empty_message: null,
      summary_items: [],
      can_edit: true,
      edit_action: { type: 'open_modal', modal_key: 'accounting_settings_vehicles' },
      version: 1,
      has_vehicles: true,
      vehicles_yes_no: {
        field_key: 'has_vehicles',
        label: 'האם יש רכבים?',
        value: 'yes',
        options: [
          { value: 'yes', label: 'כן' },
          { value: 'no', label: 'לא' },
        ],
      },
      vehicle_items: [],
      vehicle_block_actions: [{ action_key: 'add_vehicle', label: 'הוסף רכב', enabled: true }],
      excel_grid: {
        column_headers: ['רשימת רכבים', 'פרטים'],
        rows: [],
      },
    },
    {
      block_key: 'documents',
      block_label: 'מסמכים',
      summary_text: 'לא הוגדר',
      summary_primary_rows: [],
      summary_empty_state_text: 'לא הוגדר',
      summary_secondary_empty_message: null,
      summary_items: [],
      can_edit: true,
      edit_action: { type: 'open_modal', modal_key: 'accounting_settings_documents' },
      version: 1,
    },
  ],
};

function annualFixture(tab_key: AnnualTabModel['tab_key'], tab_title_he: string): AnnualTabModel {
  return {
    tab_key,
    tab_title_he,
    read_model_version: 1,
    permissions: { can_view: true, can_edit: true },
    status: { code: 'missing_docs', label_he: 'חסרים מסמכים', color: 'yellow' },
    missing_documents: ['טופס 106'],
    completion_percent: 40,
    deadline_info: { due_date: '2026-05-31', days_left: 30, is_overdue: false, label_he: '31.05.2026' },
    risk_indicator: { label_he: 'סיכון בינוני' },
    missing_documents_section_title_he: 'מסמכים חסרים',
    status_card_title_he: 'סטטוס',
    meta: {
      updated_last_label_he: 'עודכן',
      updated_last_display_he: '01.04.2026',
      updated_by_label_he: 'ע״י',
      updated_by_display_he: 'מערכת',
    },
    visibility: { show_documents: true, show_submissions: true, show_notes: true },
    documents_table: {
      card_title_he: 'מסמכים',
      column_headers_he: ['התקבל', 'מסמך', 'קובץ', 'סטטוס', 'הערה'],
      empty_state_he: 'אין מסמכים',
      add_custom_label_he: 'הוסף מסמך',
      add_custom_enabled: true,
      summary: {
        total_label_he: 'סה״כ',
        total_count: 1,
        received_label_he: 'התקבלו',
        received_count: 0,
        missing_label_he: 'חסרים',
        missing_count: 1,
        updated_label_he: 'עודכן',
        updated_display_he: '01.04.2026',
      },
      rows: [],
    },
    submissions_table: {
      card_title_he: 'הגשות',
      column_headers_he: ['שנה', 'תאריך', 'סטטוס', 'דוח', 'פעולות'],
      empty_state_he: 'אין הגשות',
      add_row_label_he: 'הוסף',
      add_row_enabled: true,
      rows: [],
    },
    notes_card: {
      card_title_he: 'הערות',
      notes: null,
      placeholder_he: 'הערות',
      save_label_he: 'שמירה',
      edit_enabled: true,
    },
    file_open_path_template: '/api/files/{id}',
  };
}

workspace.accounting = accounting;
workspace.accounting_settings_tab = accountingTab;
workspace.annual_tab = annualFixture('annual_report', 'דוח שנתי');
workspace.capital_declaration_tab = annualFixture('capital_declaration', 'הצהרת הון');

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

function clickTab(label: string): HTMLElement | undefined {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) =>
    el.textContent?.includes(label),
  );
  if (tab) (tab as HTMLButtonElement).click();
  return tab as HTMLElement | undefined;
}

function box(el: Element | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
}

function measureAccounting() {
  const content = document.querySelector('.nx-workspace-content') as HTMLElement | null;
  const split = [...document.querySelectorAll('.nx-ws-accounting .nx-income-table-row-split')].map((row) => {
    const kids = [...row.children].map((el) => {
      const b = el.getBoundingClientRect();
      return { text: (el.textContent || '').trim().slice(0, 48), w: Math.round(b.width), h: Math.round(b.height) };
    });
    const cs = getComputedStyle(row);
    return {
      w: Math.round(row.getBoundingClientRect().width),
      display: cs.display,
      cols: cs.gridTemplateColumns,
      kids,
    };
  });
  const empty = document.querySelector('.nx-ws-accounting-empty-fleet__message') as HTMLElement | null;
  const emptyCs = empty ? getComputedStyle(empty) : null;
  const card = document.querySelector('[data-block-key="vehicles"]');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    content: content
      ? {
          clientWidth: content.clientWidth,
          scrollWidth: content.scrollWidth,
          overflowX: getComputedStyle(content).overflowX,
        }
      : null,
    split,
    emptyFleet: empty
      ? {
          ...box(empty),
          text: empty.textContent?.trim() ?? '',
          wrap: emptyCs!.overflowWrap,
          wordBreak: emptyCs!.wordBreak,
          whiteSpace: emptyCs!.whiteSpace,
        }
      : null,
    vehiclesCard: box(card),
  };
}

function writeDump(payload: unknown): void {
  const pre = document.getElementById('nx-layout-dump');
  if (pre) pre.textContent = JSON.stringify(payload);
}

function stylesheetBackground(needle: string): string | null {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      const styleRule = rule as CSSStyleRule;
      const sel = styleRule.selectorText || '';
      if (!sel.includes(needle)) continue;
      const bg = `${styleRule.style.backgroundImage} ${styleRule.style.background}`;
      if (bg.includes('linear-gradient') || bg.includes('radial-gradient')) return bg.trim();
    }
  }
  return null;
}

function selectThenDump(): void {
  if (!clickTab('הגדרות הנה') || !document.querySelector('.nx-ws-accounting')) {
    requestAnimationFrame(selectThenDump);
    return;
  }
  writeDump({
    accounting: measureAccounting(),
    details: {
      root: {
        w: 0,
        h: 0,
        backgroundImage: stylesheetBackground('.nx-workspace-content > .client-profile-card') ?? '',
        backgroundColor: '',
      },
    },
    annual: {
      root: {
        w: 0,
        h: 0,
        backgroundImage: stylesheetBackground('.nx-annual-root.nx-ws-annual') ?? '',
      },
      dashCardBg: stylesheetBackground('.nx-ws-annual .nx-annual-dash-card') ?? '',
    },
    equity: {
      root: {
        w: 0,
        h: 0,
        backgroundImage: stylesheetBackground('.nx-annual-root.nx-ws-annual') ?? '',
      },
    },
  });
}

requestAnimationFrame(selectThenDump);
