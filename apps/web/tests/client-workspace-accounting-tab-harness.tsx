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
import type { FeesTabModel } from '../src/components/fees-tab-types';
import type { PayrollTabModel } from '../src/components/payroll-tab-types';
import type { ClientHistoryTabModel } from '../src/components/client-history-tab-types';

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
      value: [1],
      options: [{ value: 1, label: 'ינואר' }],
      required: false,
      editable: false,
      visible: false,
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
      editable: false,
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
      editable: false,
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
      rows: [
        {
          row_id: 'doc-106',
          source_type: 'system',
          system_key: 'form_106',
          code: '106',
          label_he: 'טופס 106',
          description_he: null,
          required: true,
          document_name_he: 'טופס 106 — אישור שנתי ממעסיק',
          received: false,
          row_note: 'הערה לדוגמה',
          status: 'missing',
          status_label_he: 'חסר',
          row_style: 'warning',
          file: { state: 'none', file_asset_id: null, file_name: null },
          actions: {
            can_toggle_received: true,
            can_attach_file: true,
            can_remove_file: false,
            can_edit_row_note: true,
            can_rename_document: false,
            can_remove_row: false,
          },
        },
      ],
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

function emptyFeesLinesEditor() {
  return {
    section_title_he: 'שירותים',
    section_subtitle_he: '',
    max_lines: 8,
    add_button: null,
    rows: [],
  };
}

function feesFixture(): FeesTabModel {
  const emptyTable = {
    section_title_he: 'שירותים',
    section_subtitle_he: '',
    column_headers_he: ['שירות', 'מחיר'],
    add_button: null,
    rows: [],
    empty_state_he: 'אין שורות',
  };
  return {
    tab_key: 'fees',
    tab_title_he: 'שכ״ט',
    read_model_version: 1,
    agreement_id: 'agr-1',
    billing_day_range: null,
    permissions: { can_view: true, can_edit: true },
    meta: {
      updated_last_label_he: 'עודכן',
      updated_last_display_he: '01.04.2026',
      updated_by_label_he: 'ע״י',
      updated_by_display_he: 'מערכת',
    },
    visibility: {
      show_agreement_details: true,
      show_service_sections: true,
      show_discount_block: true,
      show_financial_summary: true,
      show_renew_section: true,
      show_price_history: false,
      show_recent_history: false,
    },
    agreement_summary: {
      card_title_he: 'הסכם',
      no_agreement_summary_he: null,
      status_chip: { label_he: 'פעיל', token: 'active' },
      lines: [
        { label_he: 'סטטוס', value_he: 'פעיל' },
        { label_he: 'תאריך התחלה', value_he: '01.01.2026' },
      ],
    },
    edit_modal: {
      modal_title_he: 'עריכת שכ״ט',
      save_hint_he: '',
      sections: [],
      included_lines_editor: emptyFeesLinesEditor(),
      custom_lines_editor: emptyFeesLinesEditor(),
    },
    built_in_catalog: [],
    charging_type_options: [],
    vat_mode_options: [],
    fee_line_currency_options: [],
    fee_line_exchange_rate_modal: {
      title_template_he: 'שער',
      input_label_he: 'שער',
      prompt_link_he: '',
      confirm_he: 'אישור',
      cancel_he: 'ביטול',
    },
    line_editor_labels: {
      modal_title_he: 'שורה',
      catalog_service_label_he: 'שירות',
      custom_name_label_he: 'שם',
      charging_type_label_he: 'חיוב',
      price_label_he: 'מחיר',
      payslip_count_label_he: 'תלושים',
      unit_price_label_he: 'יחידה',
      quantity_label_he: 'כמות',
      currency_label_he: 'מטבע',
      line_total_label_he: 'סה״כ',
      active_label_he: 'פעיל',
      active_option_yes_he: 'כן',
      active_option_no_he: 'לא',
    },
    included_services: { ...emptyTable, section_title_he: 'כלול בהסכם' },
    custom_services: { ...emptyTable, section_title_he: 'שירותים נוספים' },
    financial_summary: {
      card_title_he: 'סיכום כספי',
      lines: [{ label_he: 'לפני מע״מ', value_he: '1,000 ₪' }],
      primary_value_he: '1,170 ₪',
    },
    discount_card: {
      card_title_he: 'הנחה',
      lines: [{ label_he: 'הנחה', value_he: 'אין' }],
      primary_value_he: null,
    },
    renewal: {
      card_title_he: 'חידוש',
      banner: null,
      lines: [{ label_he: 'חידוש אוטומטי', value_he: 'לא' }],
    },
    recent_history: {
      card_title_he: 'היסטוריה אחרונה',
      view_full_link: { label_he: 'הכל', anchor_element_id: 'fees-recent' },
      events: [],
      empty_state_he: 'אין אירועים',
    },
    price_history: {
      card_title_he: 'היסטוריית מחירים',
      column_headers_he: [],
      rows: [],
      empty_state_he: 'אין',
      section_anchor_id: 'fees-price',
      chart: {
        subtitle_he: '',
        y_axis_hint_he: '',
        bars: [],
        empty_state_he: 'אין',
        chart_view_mode: 'last_15',
        view_caption_he: '',
        overflow_hint_he: null,
        toggle_last_15_label_he: '15',
        toggle_all_label_he: 'הכל',
      },
    },
  };
}

function payrollSection(
  section_key: string,
  section_title_he: string,
  lines: Array<{ label_he: string; value_he: string }>,
): PayrollTabModel['sections'][number] {
  return { section_key, section_title_he, edit_action_key: null, lines, edit_fields: [] };
}

function payrollFixture(): PayrollTabModel {
  return {
    tab_key: 'payroll',
    tab_title_he: 'שכר',
    read_model_version: 1,
    permissions: { can_view: true, can_edit: true },
    status: { has_employees: true, has_employees_source: 'base' },
    sections: [
      payrollSection('employer_details', 'פרטי מעסיק', [{ label_he: 'שם מעסיק', value_he: 'חברת בדיקה' }]),
      payrollSection('reporting', 'דיווחים', [
        { label_he: 'דיווח למס הכנסה', value_he: 'חודשי' },
        { label_he: 'דיווח טופס 102', value_he: 'כן' },
      ]),
      payrollSection('bank', 'בנק', [{ label_he: 'חשבון', value_he: '12-345' }]),
      payrollSection('process', 'תהליך', [{ label_he: 'באיזו תוכנה מחשבים שכר', value_he: 'Priority' }]),
      payrollSection('employees', 'עובדים', [
        { label_he: 'מספר עובדים', value_he: '4' },
        { label_he: 'גרף שינוי עובדים', value_he: '—' },
      ]),
      payrollSection('complexity', 'מורכבות', [{ label_he: 'רמה', value_he: 'רגילה' }]),
    ],
  };
}

function historyFixture(): ClientHistoryTabModel {
  const keys: Array<[ClientHistoryTabModel['sections'][number]['section_key'], string]> = [
    ['client_profile', 'פרופיל'],
    ['taxes', 'מיסים'],
    ['accounting', 'הנה״ח'],
    ['fees', 'שכ״ט'],
    ['payroll', 'שכר'],
    ['annual', 'דוח שנתי'],
    ['documents', 'מסמכים'],
    ['history_system', 'מערכת'],
  ];
  return {
    tab_key: 'history',
    read_model_version: 1,
    permissions: { can_view: true, can_export: true },
    ui: {
      title_he: 'היסטוריה',
      empty_state_he: 'אין אירועים',
      retention_notice_he: 'נשמר 12 חודשים',
      retention_archival_todo_he: '',
    },
    sections: keys.map(([section_key, title_he]) => ({
      section_key,
      title_he,
      latest_events: [],
      total_events_in_last_12_months: 0,
      can_open: true,
    })),
    open_section: null,
  };
}

workspace.accounting = accounting;
workspace.accounting_settings_tab = accountingTab;
workspace.annual_tab = annualFixture('annual_report', 'דוח שנתי');
workspace.capital_declaration_tab = annualFixture('capital_declaration', 'הצהרת הון');
workspace.fees_tab = feesFixture();
workspace.payroll_tab = payrollFixture();
workspace.client_history_tab = historyFixture();

(window as Window & { __NX_HARNESS_EXPENSE_MODAL__?: unknown }).__NX_HARNESS_EXPENSE_MODAL__ = {
  modal_key: 'accounting_settings_expense_management',
  modal_label: 'עריכת ניהול הוצאות',
  block_key: 'expense_management',
  version: 1,
  can_edit: true,
  fields: [
    { key: 'expense_software_name', label: 'שם תוכנת הוצאות', type: 'text', value: 'חשבשבת', required: false, visible: true, editable: true },
    { key: 'expense_software_username', label: 'קוד משתמש למערכת הוצאות', type: 'text', value: 'demo-user', required: false, visible: true, editable: true },
    { key: 'expense_software_password', label: 'סיסמה', type: 'secure_text', value: 'secret-pass', required: false, visible: true, editable: true },
    { key: 'expense_software_url', label: 'כתובת מערכת', type: 'text', value: 'https://expenses.example.com', required: false, visible: true, editable: true },
    {
      key: 'expense_delivery_method',
      label: 'קבלת הוצאות',
      type: 'enum_single',
      value: 'email',
      required: false,
      visible: true,
      editable: true,
      options: [
        { value: 'email', label: 'מייל' },
        { value: 'upload', label: 'העלאה' },
      ],
    },
    { key: 'expense_uploaded_by', label: 'הועלה על ידי', type: 'text', value: 'ישראל ישראלי', required: false, visible: true, editable: true },
    {
      key: 'expense_documents_order_level',
      label: 'רמת סדר',
      type: 'enum_single',
      value: 'high',
      required: false,
      visible: true,
      editable: true,
      options: [{ value: 'high', label: 'גבוהה' }],
    },
    { key: 'expense_management_notes', label: 'הערות על ניהול הוצאות', type: 'textarea', value: 'הערות לדוגמה לבדיקת ניגודיות', required: false, visible: true, editable: true },
    { key: 'em_cf_1', label: 'שדה מותאם', type: 'text', value: 'מותאם', required: false, visible: true, editable: true },
  ],
  expense_management_modal_meta: {
    custom_field_capacity: 5,
    custom_field_count: 1,
    custom_field_type_default: 'text',
    custom_field_type_placeholder_he: 'בחר סוג',
    custom_field_type_options: [{ value: 'text', label: 'טקסט' }],
    custom_field_types_requiring_options: ['select'],
    custom_field_options_max_count: 8,
  },
};

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

function contentBox() {
  const content = document.querySelector('.nx-workspace-content') as HTMLElement | null;
  return content
    ? {
        clientWidth: content.clientWidth,
        scrollWidth: content.scrollWidth,
        overflowX: getComputedStyle(content).overflowX,
      }
    : null;
}

function measureAccounting() {
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
  const grid = document.querySelector('.nx-ws-accounting .nx-accounting-cards-grid') as HTMLElement | null;
  const gcs = grid ? getComputedStyle(grid) : null;
  const keys = ['income', 'expense_management', 'expenses', 'vehicles'] as const;
  const cards = Object.fromEntries(keys.map((k) => [k, box(document.querySelector(`[data-block-key="${k}"]`))]));
  const profileRows = Array.from(document.querySelectorAll('.nx-ws-accounting-row')).map((row) => {
    const label = (row.querySelector('.nx-ws-accounting-row__label')?.textContent || '').trim();
    const value = (row.querySelector('.nx-ws-accounting-row__value')?.textContent || '').trim();
    return { label, value };
  });
  const tabs = Array.from(document.querySelectorAll('.nx-workspace-panel-root .nx-workspace-tab-link')).map((el) => {
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent || '').trim(),
      font: cs.fontFamily,
      size: cs.fontSize,
      wrap: cs.whiteSpace,
      overflow: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1,
    };
  });
  return {
    profileRows,
    peakMonthsVisible: profileRows.some((r) => r.label.includes('חודשי עומס')),
    openDate: profileRows.find((r) => r.label.includes('פתיחת עסק'))?.value ?? null,
    closeDate: profileRows.find((r) => r.label.includes('סגירת עסק'))?.value ?? null,
    tabs,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    content: contentBox(),
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
    vehiclesCard: cards.vehicles,
    grid: grid
      ? {
          ...box(grid),
          cols: gcs!.gridTemplateColumns,
          areas: gcs!.gridTemplateAreas,
          direction: gcs!.direction,
        }
      : null,
    cards,
  };
}

function measureNotes() {
  const wrap = document.querySelector('.nx-ws-annual .nx-annual-table-wrap') as HTMLElement | null;
  const table = wrap?.querySelector('table') as HTMLElement | null;
  const inp = wrap?.querySelector('.nx-annual-note-inp') as HTMLElement | null;
  if (!wrap || !inp) return null;
  const wr = wrap.getBoundingClientRect();
  const ir = inp.getBoundingClientRect();
  return {
    wrap: box(wrap),
    table: box(table),
    input: box(inp),
    overflowLeft: Math.round(wr.left - ir.left),
    overflowRight: Math.round(ir.right - wr.right),
    content: contentBox(),
  };
}

function measureGlassTab(rootSel: string) {
  const root = document.querySelector(rootSel) as HTMLElement | null;
  return {
    root: box(root),
    content: contentBox(),
  };
}

function writeDump(payload: unknown): void {
  const pre = document.getElementById('nx-layout-dump');
  if (pre) pre.textContent = JSON.stringify(payload);
}

function computedBg(sel: string): string {
  const el = document.querySelector(sel);
  if (!el) return '';
  const cs = getComputedStyle(el);
  return `${cs.backgroundImage} ${cs.backgroundColor}`;
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

const DUMP_TARGETS: Record<string, { label: string; ready: string }> = {
  accounting: { label: 'הגדרות הנה', ready: '.nx-ws-accounting' },
  annual: { label: 'דוח שנתי', ready: '.nx-annual-note-inp' },
  equity: { label: 'הצהרת הון', ready: '.nx-annual-note-inp' },
  fees: { label: 'שכ״ט', ready: '.nx-ws-fees .nx-fees-card' },
  payroll: { label: 'שכר', ready: '.nx-ws-payroll .nx-payroll-card' },
  history: { label: 'היסטוריה', ready: '.nx-ws-history .nx-history-hero' },
};

function basePayload(): Record<string, unknown> {
  return {
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
  };
}

let expenseEditorOpened = false;
let expenseEditorWaitFrames = 0;

function selectThenDump(): void {
  const dumpKey = new URLSearchParams(location.search).get('dump') || 'accounting';
  const spec =
    dumpKey === 'fees-editor'
      ? DUMP_TARGETS.fees
      : dumpKey === 'profile-editor' || dumpKey === 'expense-editor'
        ? DUMP_TARGETS.accounting
        : DUMP_TARGETS[dumpKey] ?? DUMP_TARGETS.accounting;
  if (!clickTab(spec.label) || !document.querySelector(spec.ready)) {
    requestAnimationFrame(selectThenDump);
    return;
  }
  const payload = basePayload();
  if (dumpKey === 'accounting') payload.accounting = measureAccounting();
  if (dumpKey === 'annual') {
    payload.annual = { ...(payload.annual as object), notes: measureNotes() };
  }
  if (dumpKey === 'equity') {
    payload.equity = { ...(payload.equity as object), notes: measureNotes() };
  }
  if (dumpKey === 'fees') {
    payload.fees = {
      ...measureGlassTab('.nx-ws-fees'),
      cardBg: computedBg('.nx-ws-fees .nx-fees-card') || stylesheetBackground('.nx-ws-fees .nx-fees-card') || '',
    };
  }
  if (dumpKey === 'payroll') {
    payload.payroll = {
      ...measureGlassTab('.nx-ws-payroll'),
      cardBg:
        computedBg('.nx-ws-payroll .nx-payroll-card') ||
        stylesheetBackground('.nx-payroll-tab-shell .nx-payroll-card') ||
        '',
    };
  }
  if (dumpKey === 'history') {
    const hero = document.querySelector('.nx-ws-history .nx-history-title') as HTMLElement | null;
    const meta = document.querySelector('.nx-ws-history .nx-history-event-meta, .nx-ws-history .nx-history-retention') as HTMLElement | null;
    payload.history = {
      ...measureGlassTab('.nx-ws-history'),
      heroBg: computedBg('.nx-ws-history .nx-history-hero') || stylesheetBackground('.nx-ws-history .nx-history-hero') || '',
      titleFont: hero ? getComputedStyle(hero).fontFamily : '',
      titleWeight: hero ? getComputedStyle(hero).fontWeight : '',
      metaFont: meta ? getComputedStyle(meta).fontFamily : '',
      rootFont: (() => {
        const root = document.querySelector('.nx-ws-history') as HTMLElement | null;
        return root ? getComputedStyle(root).fontFamily : '';
      })(),
    };
  }
  if (dumpKey === 'fees-editor') {
    if (!document.querySelector('.nx-fees-editor-modal')) {
      const pencil = document.querySelector('.nx-fees-pencil-btn') as HTMLButtonElement | null;
      pencil?.click();
      requestAnimationFrame(selectThenDump);
      return;
    }
    payload.feesEditor = measureFeesEditor();
  }
  if (dumpKey === 'profile-editor') {
    if (!document.querySelector('.nx-accounting-editor-modal')) {
      const btn = document.querySelector('[aria-label="עריכת פרופיל עסקי"]') as HTMLButtonElement | null;
      btn?.click();
      requestAnimationFrame(selectThenDump);
      return;
    }
    payload.profileEditor = measureProfileEditor();
  }
  if (dumpKey === 'expense-editor') {
    if (!document.querySelector('.nx-em-modal-2col') && expenseEditorWaitFrames < 90) {
      expenseEditorWaitFrames += 1;
      if (!expenseEditorOpened) {
        const btn = document.querySelector('[aria-label="עריכת הוצאות"]') as HTMLButtonElement | null;
        if (btn) {
          expenseEditorOpened = true;
          btn.click();
        }
      }
      requestAnimationFrame(selectThenDump);
      return;
    }
    payload.expenseEditor = measureExpenseEditor();
  }
  writeDump(payload);
}

function rgbChannels(color: string): number[] {
  return (color.match(/\d+/g) || []).map(Number);
}

function measureExpenseEditor(): Record<string, unknown> {
  const modal = document.querySelector('.nx-accounting-editor-modal') as HTMLElement | null;
  const col = document.querySelector('.nx-em-modal-2col') as HTMLElement | null;
  const header = modal?.querySelector('.nx-modal-header') as HTMLElement | null;
  const close = modal?.querySelector('.nx-modal-close') as HTMLElement | null;
  const label = modal?.querySelector('.client-field-label') as HTMLElement | null;
  const input = modal?.querySelector('.nx-em-modal-2col input, .nx-em-modal-2col select, .nx-em-modal-2col textarea') as HTMLElement | null;
  const workspaceClose = document.querySelector('.nx-workspace-close') as HTMLElement | null;
  const mr = modal?.getBoundingClientRect();
  const cr = close?.getBoundingClientRect();
  const hr = header?.getBoundingClientRect();
  const wcr = workspaceClose?.getBoundingClientRect();
  const colCs = col ? getComputedStyle(col) : null;
  const labelCs = label ? getComputedStyle(label) : null;
  const inputCs = input ? getComputedStyle(input) : null;
  const bg = colCs ? `${colCs.backgroundImage} ${colCs.backgroundColor}` : '';
  return {
    title: modal?.querySelector('.nx-modal-title')?.textContent?.trim() ?? '',
    colCount: document.querySelectorAll('.nx-em-modal-col').length,
    labels: Array.from(modal?.querySelectorAll('.client-field-label') ?? []).map((el) => (el.textContent || '').trim()),
    footerBtns: Array.from(modal?.querySelectorAll('.nx-modal-footer .nx-btn') ?? []).map((b) => (b.textContent || '').trim()),
    background: bg,
    labelColor: labelCs?.color ?? '',
    inputColor: inputCs?.color ?? '',
    inputBg: inputCs ? `${inputCs.backgroundImage} ${inputCs.backgroundColor}` : '',
    font: colCs?.fontFamily ?? '',
    overflowX: colCs?.overflowX ?? '',
    scrollWidth: col?.scrollWidth ?? 0,
    clientWidth: col?.clientWidth ?? 0,
    header: header && hr ? { w: hr.width, h: hr.height, x: hr.x, y: hr.y } : null,
    close: close && cr ? { w: cr.width, h: cr.height, x: cr.x, y: cr.y } : null,
    workspaceClose: workspaceClose && wcr ? { w: wcr.width, h: wcr.height, x: wcr.x, y: wcr.y } : null,
    modal: modal && mr ? { w: mr.width, h: mr.height, x: mr.x, y: mr.y } : null,
    whitePanel: /rgb\(\s*255,\s*255,\s*255\s*\)|#fff|#ffffff/i.test(bg) && !/linear-gradient/i.test(bg),
    labelRgb: rgbChannels(labelCs?.color ?? ''),
    inputRgb: rgbChannels(inputCs?.color ?? ''),
  };
}

function measureProfileEditor(): Record<string, unknown> {
  const modal = document.querySelector('.nx-accounting-editor-modal') as HTMLElement | null;
  const header = modal?.querySelector('.nx-modal-header') as HTMLElement | null;
  const close = modal?.querySelector('.nx-modal-close') as HTMLElement | null;
  const body = modal?.querySelector('.nx-modal-body') as HTMLElement | null;
  const workspaceClose = document.querySelector('.nx-workspace-close') as HTMLElement | null;
  const labels = Array.from(modal?.querySelectorAll('.client-field-label') ?? []).map((el) => (el.textContent || '').trim());
  const bodyText = body?.textContent || '';
  const mr = modal?.getBoundingClientRect();
  const hr = header?.getBoundingClientRect();
  const cr = close?.getBoundingClientRect();
  const wcr = workspaceClose?.getBoundingClientRect();
  return {
    hiddenOpenDate: !labels.some((l) => l.includes('פתיחת עסק')) && !bodyText.includes('פתיחת עסק'),
    hiddenCloseDate: !labels.some((l) => l.includes('סגירת עסק')) && !bodyText.includes('סגירת עסק'),
    hiddenPeakMonths: !labels.some((l) => l.includes('חודשי עומס')) && !bodyText.includes('חודשי עומס'),
    labels,
    header: header && hr ? { w: hr.width, h: hr.height, x: hr.x, y: hr.y } : null,
    close: close && cr ? { w: cr.width, h: cr.height, x: cr.x, y: cr.y } : null,
    workspaceClose: workspaceClose && wcr ? { w: wcr.width, h: wcr.height, x: wcr.x, y: wcr.y } : null,
    overflowX: body ? getComputedStyle(body).overflowX : '',
    bodyScrollWidth: body?.scrollWidth ?? 0,
    bodyClientWidth: body?.clientWidth ?? 0,
    modal: modal && mr ? { w: mr.width, h: mr.height, x: mr.x, y: mr.y } : null,
  };
}

function measureFeesEditor(): Record<string, unknown> {
  const modal = document.querySelector('.nx-fees-editor-modal') as HTMLElement | null;
  const close = modal?.querySelector('.nx-modal-close') as HTMLElement | null;
  const wrap = modal?.querySelector('.nx-fees-table-wrap') as HTMLElement | null;
  const workspace = document.querySelector('.nx-modal.nx-workspace-modal') as HTMLElement | null;
  const wsClose = document.querySelector('.nx-workspace-close') as HTMLElement | null;
  const mr = modal?.getBoundingClientRect();
  const cr = close?.getBoundingClientRect();
  const wr = workspace?.getBoundingClientRect();
  const wcr = wsClose?.getBoundingClientRect();
  const mcs = modal ? getComputedStyle(modal) : null;
  return {
    modal: modal && mr && mcs
      ? {
          w: mr.width,
          h: mr.height,
          x: mr.x,
          y: mr.y,
          font: mcs.fontFamily,
          backgroundImage: mcs.backgroundImage,
          overflowX: mcs.overflowX,
        }
      : null,
    close: close && cr ? { w: cr.width, h: cr.height, x: cr.x, y: cr.y } : null,
    tableWrap: wrap
      ? {
          clientWidth: wrap.clientWidth,
          scrollWidth: wrap.scrollWidth,
          overflowX: getComputedStyle(wrap).overflowX,
        }
      : null,
    footerBtns: Array.from(modal?.querySelectorAll('.nx-modal-footer .nx-btn') ?? []).map((b) =>
      (b.textContent || '').trim(),
    ),
    workspace: workspace && wr ? { w: wr.width, h: wr.height, x: wr.x, y: wr.y, font: getComputedStyle(workspace).fontFamily } : null,
    workspaceClose: wsClose && wcr ? { w: wcr.width, h: wcr.height, x: wcr.x, y: wcr.y } : null,
  };
}

requestAnimationFrame(selectThenDump);
