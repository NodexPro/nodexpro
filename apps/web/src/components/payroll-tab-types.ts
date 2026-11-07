export type PayrollFieldModel = {
  key: string;
  label_he: string;
  label_key?: string;
  type: 'text' | 'number' | 'select' | 'radio' | 'textarea';
  value: string | number | boolean | null;
  options?: Array<{ value: string; label_he: string; label_key?: string }>;
};

export type PayrollLineModel = {
  line_key: string;
  label_he: string;
  label_key?: string;
  value_he: string;
  value_key?: string;
};

export type PayrollSectionModel = {
  section_key: string;
  section_title_he: string;
  section_title_key?: string;
  edit_action_key:
    | 'update_payroll_status'
    | 'update_payroll_employer_details'
    | 'update_payroll_bank_details'
    | 'update_payroll_reporting'
    | 'update_payroll_process'
    | 'update_payroll_complexity'
    | 'update_payroll_employees'
    | null;
  lines: PayrollLineModel[];
  edit_fields: PayrollFieldModel[];
};

export type PayrollTabModel = {
  tab_key: 'payroll';
  tab_title_he: string;
  tab_title_key?: string;
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  status: { has_employees: boolean; has_employees_source: 'base' | 'override' };
  sections: PayrollSectionModel[];
};
