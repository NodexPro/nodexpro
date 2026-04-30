export type PayrollFieldModel = {
  key: string;
  label_he: string;
  type: 'text' | 'number' | 'select' | 'radio' | 'textarea';
  value: string | number | boolean | null;
  options?: Array<{ value: string; label_he: string }>;
};

export type PayrollSectionModel = {
  section_key: string;
  section_title_he: string;
  edit_action_key:
    | 'update_payroll_status'
    | 'update_payroll_employer_details'
    | 'update_payroll_bank_details'
    | 'update_payroll_reporting'
    | 'update_payroll_process'
    | 'update_payroll_complexity'
    | 'update_payroll_employees'
    | null;
  lines: Array<{ label_he: string; value_he: string }>;
  edit_fields: PayrollFieldModel[];
};

export type PayrollTabModel = {
  tab_key: 'payroll';
  tab_title_he: string;
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  status: { has_employees: boolean; has_employees_source: 'base' | 'override' };
  sections: PayrollSectionModel[];
};
