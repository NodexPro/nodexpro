/**
 * Client Operations registry — presentation contract (columns + toolbar capabilities).
 * System columns plus organization-owned custom column presentation helpers.
 */

export type RegistryColumnCellKind = 'folder' | 'text' | 'notes' | 'custom' | 'checkbox';
export type ClientOperationsCustomColumnDataType = 'text' | 'number' | 'date' | 'boolean';

export type ClientOperationsRegistryColumn = {
  key: string;
  label: string;
  cell_kind: RegistryColumnCellKind;
  /** Field on the row used for legacy/WE compatibility; null for action columns. */
  value_field: string | null;
  data_type?: ClientOperationsCustomColumnDataType;
  custom_column_id?: string;
  default_width_px?: number;
  visible: boolean;
  system: boolean;
  editable: boolean;
  freeze_default: boolean;
  align: 'right' | 'center' | 'left';
};

export type ClientOperationsToolbarCapability = {
  id: string;
  label_he: string;
  available: boolean;
  reason_he: string | null;
  group: 'history' | 'query' | 'format' | 'structure' | 'more';
};

/** Fixed system columns — labels match the live Client Operations registry. */
export const CLIENT_OPERATIONS_REGISTRY_COLUMNS: ClientOperationsRegistryColumn[] = [
  {
    key: 'folder',
    label: '📁',
    cell_kind: 'folder',
    value_field: null,
    visible: true,
    system: true,
    editable: false,
    freeze_default: true,
    align: 'center',
  },
  {
    key: 'client_name',
    label: 'שם לקוח',
    cell_kind: 'text',
    value_field: 'client_name',
    visible: true,
    system: true,
    editable: false,
    freeze_default: true,
    align: 'right',
  },
  {
    key: 'tax_id',
    label: 'ח.פ',
    cell_kind: 'text',
    value_field: 'tax_id',
    visible: false,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'business_type',
    label: 'סוג עסק',
    cell_kind: 'text',
    value_field: 'business_type',
    visible: false,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'payroll',
    label: 'שכר',
    cell_kind: 'text',
    value_field: 'payroll_flag',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'material_brought',
    label: 'חומר למע״מ',
    cell_kind: 'checkbox',
    value_field: 'material_brought_flag',
    visible: true,
    system: true,
    editable: true,
    freeze_default: false,
    align: 'center',
    default_width_px: 84,
  },
  {
    key: 'vat',
    label: 'מע״מ',
    cell_kind: 'text',
    value_field: 'vat_status',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'vat_due',
    label: 'יום יעד דיווח מע״מ',
    cell_kind: 'text',
    value_field: 'vat_due_registry_display_he',
    visible: false,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'income_tax_advance',
    label: 'מקדמות מס הכנסה',
    cell_kind: 'text',
    value_field: 'income_tax_advance_status',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'national_insurance',
    label: 'ביטוח לאומי',
    cell_kind: 'text',
    value_field: 'national_insurance_status',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'national_insurance_deductions',
    label: 'ביטוח לאומי ניכויים',
    cell_kind: 'text',
    value_field: 'national_insurance_deductions_status',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'income_tax_deductions',
    label: 'מס הכנסה ניכויים',
    cell_kind: 'text',
    value_field: 'income_tax_deductions_status',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'handler',
    label: 'מטפל בתיק',
    cell_kind: 'text',
    value_field: null,
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
  {
    key: 'notes',
    label: 'הערות',
    cell_kind: 'notes',
    value_field: 'notes_cell_text_he',
    visible: true,
    system: true,
    editable: false,
    freeze_default: false,
    align: 'right',
  },
];

const SYSTEM_COLUMN_KEYS = new Set(CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => c.key));
export const CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX = 10;

export function isSystemRegistryColumnKey(key: string): boolean {
  return SYSTEM_COLUMN_KEYS.has(key);
}

/** A stable, URL/column-safe key seed. Untransliterable labels use `custom_column`. */
export function slugifyCustomColumnKey(label: string): string {
  const slug = String(label ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || 'custom_column';
}

export function assertNotSystemColumnKey(key: string): void {
  if (isSystemRegistryColumnKey(key)) {
    throw new Error(`Custom column key collides with system column: ${key}`);
  }
}

export function buildCustomColumnsCapability({ current, canEdit }: { current: number; canEdit: boolean }) {
  return {
    max: CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX,
    current: Math.max(0, current),
    can_create: canEdit && current < CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX,
  };
}

function boolHe(v: boolean | null | undefined): string {
  if (v === true) return 'כן';
  if (v === false) return 'לא';
  return '—';
}

function textHe(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export function formatCustomCellDisplayHe(
  dataType: ClientOperationsCustomColumnDataType,
  values: {
    value_text?: string | null;
    value_number?: number | string | null;
    value_date?: string | null;
    value_bool?: boolean | null;
  }
): string {
  if (dataType === 'text') return textHe(values.value_text);
  if (dataType === 'boolean') return boolHe(values.value_bool);
  if (dataType === 'date') {
    const raw = values.value_date;
    if (!raw) return '—';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : textHe(raw);
  }
  const value = values.value_number;
  if (value === null || value === undefined || value === '') return '—';
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? new Intl.NumberFormat('he-IL', { maximumFractionDigits: 6 }).format(numberValue) : textHe(value);
}

export function mergeCustomCellsIntoRow<T extends { cells: Record<string, string>; client_id: string }>(
  row: T,
  customColumns: Array<{ key: string; id: string; data_type: ClientOperationsCustomColumnDataType }>,
  valuesByClientAndColumn: Map<
    string,
    { value_text?: string | null; value_number?: number | string | null; value_date?: string | null; value_bool?: boolean | null }
  >
): T {
  const cells = { ...row.cells };
  for (const column of customColumns) {
    const value = valuesByClientAndColumn.get(`${row.client_id}:${column.id}`);
    cells[column.key] = formatCustomCellDisplayHe(column.data_type, value ?? {});
  }
  return { ...row, cells };
}

/** Format national-insurance amount display the same way the prior FE helper did (visual only). */
export function formatNationalInsuranceCellDisplayHe(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v).trim();
  if (s.includes('₪')) return s;
  if (s === 'לא עונה להגדרות') return s;
  if (/^[\d\u00A0\s,\u2009\u202F.]+$/.test(s)) {
    return `${s}\u00A0₪`;
  }
  return s;
}

export function buildRegistryRowCells(input: {
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
  vat_status: string | null;
  vat_due_registry_display_he: string | null;
  income_tax_advance_status: string | null;
  national_insurance_status: string | null;
  national_insurance_deductions_status: string | null;
  income_tax_deductions_status: string | null;
  assigned_handler_display_he: string | null;
  notes_cell_text_he: string | null;
}): Record<string, string> {
  return {
    client_name: textHe(input.client_name),
    tax_id: textHe(input.tax_id),
    business_type: textHe(input.business_type),
    payroll: boolHe(input.payroll_flag),
    material_brought: boolHe(input.material_brought_flag),
    vat: textHe(input.vat_status),
    vat_due: textHe(input.vat_due_registry_display_he),
    income_tax_advance: textHe(input.income_tax_advance_status),
    national_insurance: formatNationalInsuranceCellDisplayHe(input.national_insurance_status),
    national_insurance_deductions: textHe(input.national_insurance_deductions_status),
    income_tax_deductions: textHe(input.income_tax_deductions_status),
    handler: textHe(input.assigned_handler_display_he),
    notes: textHe(input.notes_cell_text_he),
  };
}

export function buildClientOperationsToolbarCapabilities(opts: {
  can_create_custom_column?: boolean;
  can_create_reason_he?: string | null;
} = {}): ClientOperationsToolbarCapability[] {
  return [
    {
      id: 'undo',
      label_he: 'בטל',
      available: true,
      reason_he: null,
      group: 'history',
    },
    {
      id: 'redo',
      label_he: 'בצע שוב',
      available: true,
      reason_he: null,
      group: 'history',
    },
    {
      id: 'search',
      label_he: 'חיפוש',
      available: true,
      reason_he: null,
      group: 'query',
    },
    {
      id: 'filter',
      label_he: 'סינון',
      available: false,
      reason_he: 'סינון מתקדם דורש מודל שאילתה בשרת שטרם הוגדר',
      group: 'query',
    },
    {
      id: 'sort_asc',
      label_he: 'מיון עולה',
      available: true,
      reason_he: null,
      group: 'query',
    },
    {
      id: 'sort_desc',
      label_he: 'מיון יורד',
      available: true,
      reason_he: null,
      group: 'query',
    },
    {
      id: 'align_right',
      label_he: 'יישור לימין',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'align_center',
      label_he: 'יישור למרכז',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'align_left',
      label_he: 'יישור לשמאל',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'wrap_text',
      label_he: 'גלישת טקסט',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'bold',
      label_he: 'מודגש',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'italic',
      label_he: 'נטוי',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'underline',
      label_he: 'קו תחתון',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'text_color',
      label_he: 'צבע טקסט',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'fill_color',
      label_he: 'צבע רקע',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'number_format',
      label_he: 'פורמט מספר',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'borders',
      label_he: 'גבולות',
      available: true,
      reason_he: null,
      group: 'format',
    },
    {
      id: 'freeze_columns',
      label_he: 'הקפאת עמודות',
      available: true,
      reason_he: null,
      group: 'structure',
    },
    {
      id: 'toggle_columns',
      label_he: 'הצג / הסתר עמודות',
      available: true,
      reason_he: null,
      group: 'structure',
    },
    {
      id: 'fullscreen',
      label_he: 'מסך מלא',
      available: true,
      reason_he: null,
      group: 'structure',
    },
    {
      id: 'add_column',
      label_he: '+ עמודה',
      available: opts.can_create_custom_column === true,
      reason_he:
        opts.can_create_custom_column === true
          ? null
          : (opts.can_create_reason_he ?? 'אין הרשאה להוספת עמודה מותאמת אישית או שהגעת למגבלת העמודות'),
      group: 'structure',
    },
  ];
}

export type RegistryQueryInput = {
  q?: string | null;
  sort_by?: string | null;
  sort_dir?: 'asc' | 'desc' | null;
  operational_period_key?: string | null;
};

export function applyRegistryQueryToRows<
  T extends { client_id: string; cells: Record<string, string>; client_name: string | null },
>(rows: T[], query: RegistryQueryInput): T[] {
  let out = rows;
  const q = (query.q ?? '').trim().toLowerCase();
  if (q) {
    out = out.filter((r) => {
      if ((r.client_name ?? '').toLowerCase().includes(q)) return true;
      return Object.values(r.cells).some((v) => v.toLowerCase().includes(q));
    });
  }
  const sortBy = query.sort_by?.trim() || null;
  if (sortBy && sortBy !== 'folder') {
    const dir = query.sort_dir === 'desc' ? -1 : 1;
    out = [...out].sort((a, b) => {
      const av = (a.cells[sortBy] ?? '').localeCompare(b.cells[sortBy] ?? '', 'he');
      return av * dir;
    });
  }
  return out;
}
