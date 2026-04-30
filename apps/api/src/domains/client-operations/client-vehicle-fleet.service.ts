import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';

const BUCKET = 'client-files';
const MAX_FILE = 10 * 1024 * 1024;
const MAX_B64 = Math.ceil(MAX_FILE / 3) * 4;
export const MAX_VEHICLES_PER_CLIENT = 15;

const FLEET_MANUFACTURE_YEAR_MIN = 1950;
const FLEET_MANUFACTURE_YEAR_MAX = 2100;

export type OwnershipKind = 'business_vehicle' | 'private_vehicle' | 'leasing' | 'rental' | 'other';
export type AssignedTo = 'business_owner' | 'spouse' | 'employee' | 'company' | 'other';
export type RecognizedInBusiness = 'yes' | 'no' | 'partial';
export type AcquisitionMethod = 'purchased' | 'leasing' | 'rental' | 'transferred_private' | 'other';
export type FuelVatOffsetMode = 'full' | 'two_thirds' | 'other';
export type VehicleExpVatOffsetMode = 'full' | 'two_thirds' | 'none' | 'other';
export type VehicleStatus = 'active' | 'sold' | 'inactive';

export type VehicleFleetRow = {
  id: string;
  sort_order: number;
  ownership_kind: OwnershipKind;
  license_plate: string | null;
  manufacturer: string | null;
  model: string | null;
  manufacture_year: number | null;
  vehicle_cost_ils: number | null;
  purchase_date: string | null;
  vehicle_owner_name: string | null;
  assigned_to: AssignedTo | null;
  recognized_in_business: RecognizedInBusiness | null;
  current_value_ils: number | null;
  acquisition_method: AcquisitionMethod | null;
  business_use_percent: number | null;
  has_fuel_expenses: boolean;
  fuel_vat_offset_mode: FuelVatOffsetMode | null;
  fuel_vat_offset_custom_percent: number | null;
  has_additional_vehicle_expenses: boolean;
  vehicle_exp_vat_offset_mode: VehicleExpVatOffsetMode | null;
  vehicle_exp_vat_offset_custom_percent: number | null;
  vehicle_status: VehicleStatus;
  sale_date: string | null;
  sale_price_ils: number | null;
  notes: string | null;
  license_file_asset_id: string | null;
  license_file_name: string | null;
  comprehensive_insurance_file_asset_id: string | null;
  comprehensive_insurance_file_name: string | null;
  compulsory_insurance_file_asset_id: string | null;
  compulsory_insurance_file_name: string | null;
};

export type VehicleListItemDto = {
  vehicle_id: string;
  /** Ready-to-render lines (Hebrew), top to bottom */
  summary_lines: string[];
  edit_action?: { label: string; enabled: boolean };
};

export type VehicleBlockActionDto = {
  action_key: 'add_vehicle' | 'edit_vehicle';
  label: string;
  enabled: boolean;
/** For edit_vehicle — target row */
  vehicle_id?: string;
};

export type VehiclesYesNoFieldDto = {
  field_key: 'has_vehicles';
  label: string;
  value: 'yes' | 'no';
  options: { value: 'yes' | 'no'; label: string }[];
};

/** Modal field shape aligned with accounting FieldSchema (+ optional grouping / presentation). */
export type VehicleItemFieldSchema = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'enum_single'
    | 'boolean'
    | 'integer'
    | 'numeric'
    | 'date'
    | 'vehicle_file';
  value: unknown;
  options?: Array<{ value: string | number | boolean; label: string }>;
  required: boolean;
  visible: boolean;
  editable: boolean;
  placeholder?: string;
  max_length?: number;
  min?: number;
  max?: number;
  /** When set, UI may render a section title before this field */
  group_label?: string;
  /** enum_single: render as radio row instead of select */
  display_as?: 'radio';
};

export type VehicleFleetItemModalResponse = {
  modal_key: 'accounting_settings_vehicle_item';
  modal_label: string;
  block_key: 'vehicles';
  vehicle_id: string | null;
  parent_vehicles_version: number;
  can_edit: boolean;
  field_visibility: Record<string, boolean>;
  fields: VehicleItemFieldSchema[];
};

const OWNERSHIP_KIND_OPTS: Array<{ value: OwnershipKind; label: string }> = [
  { value: 'business_vehicle', label: 'רכב עסקי' },
  { value: 'private_vehicle', label: 'רכב פרטי' },
  { value: 'leasing', label: 'ליסינג' },
  { value: 'rental', label: 'שכור' },
  { value: 'other', label: 'אחר' },
];

const ASSIGNED_TO_OPTS: Array<{ value: AssignedTo; label: string }> = [
  { value: 'business_owner', label: 'בעל העסק' },
  { value: 'spouse', label: 'בן/בת זוג' },
  { value: 'employee', label: 'עובד' },
  { value: 'company', label: 'חברה' },
  { value: 'other', label: 'אחר' },
];

const RECOGNIZED_OPTS: Array<{ value: RecognizedInBusiness; label: string }> = [
  { value: 'yes', label: 'כן' },
  { value: 'no', label: 'לא' },
  { value: 'partial', label: 'חלקית' },
];

const ACQUISITION_OPTS: Array<{ value: AcquisitionMethod; label: string }> = [
  { value: 'purchased', label: 'נקנה' },
  { value: 'leasing', label: 'ליסינג' },
  { value: 'rental', label: 'השכרה' },
  { value: 'transferred_private', label: 'הועבר מבעלות פרטית' },
  { value: 'other', label: 'אחר' },
];

const FUEL_VAT_OPTS: Array<{ value: FuelVatOffsetMode; label: string }> = [
  { value: 'full', label: 'מלא' },
  { value: 'two_thirds', label: '2/3' },
  { value: 'other', label: 'אחר' },
];

const VEHICLE_EXP_VAT_OPTS: Array<{ value: VehicleExpVatOffsetMode; label: string }> = [
  { value: 'full', label: 'מלא' },
  { value: 'two_thirds', label: '2/3' },
  { value: 'none', label: 'ללא' },
  { value: 'other', label: 'אחר' },
];

const VEHICLE_STATUS_OPTS: Array<{ value: VehicleStatus; label: string }> = [
  { value: 'active', label: 'פעיל' },
  { value: 'sold', label: 'נמכר' },
  { value: 'inactive', label: 'לא פעיל' },
];

const OWNERSHIP_KIND_LABEL = new Map(OWNERSHIP_KIND_OPTS.map((o) => [o.value, o.label]));
const ASSIGNED_TO_LABEL = new Map(ASSIGNED_TO_OPTS.map((o) => [o.value, o.label]));
const RECOGNIZED_LABEL = new Map(RECOGNIZED_OPTS.map((o) => [o.value, o.label]));
const ACQUISITION_LABEL = new Map(ACQUISITION_OPTS.map((o) => [o.value, o.label]));
const FUEL_VAT_LABEL = new Map(FUEL_VAT_OPTS.map((o) => [o.value, o.label]));
const VEHICLE_EXP_VAT_LABEL = new Map(VEHICLE_EXP_VAT_OPTS.map((o) => [o.value, o.label]));
const VEHICLE_STATUS_LABEL = new Map(VEHICLE_STATUS_OPTS.map((o) => [o.value, o.label]));

function ownershipLegacyFromKind(kind: OwnershipKind): 'business' | 'private' {
  return kind === 'private_vehicle' ? 'private' : 'business';
}

function fleetStatusSortRank(s: VehicleStatus): number {
  if (s === 'active') return 0;
  if (s === 'inactive') return 1;
  if (s === 'sold') return 2;
  return 3;
}

function sortFleetRows(rows: VehicleFleetRow[]): VehicleFleetRow[] {
  return [...rows].sort((a, b) => {
    const r = fleetStatusSortRank(a.vehicle_status) - fleetStatusSortRank(b.vehicle_status);
    if (r !== 0) return r;
    return a.sort_order - b.sort_order;
  });
}

/** ערכי תצוגה לכרטיס/רשת רכב (מספר רישוי, סוג בעלות, שיוך, מע״מ דלק). */
export function vehicleFleetRowSummaryFields(row: VehicleFleetRow): {
  license_plate: string;
  ownership_label: string;
  assigned_label: string;
  fuel_vat_label: string;
} {
  const plate = row.license_plate?.trim() || '—';
  const ownership_label = String(OWNERSHIP_KIND_LABEL.get(row.ownership_kind) ?? row.ownership_kind);
  const assigned_label = row.assigned_to
    ? ASSIGNED_TO_LABEL.get(row.assigned_to) ?? String(row.assigned_to)
    : '—';
  let fuel_vat_label = '—';
  if (row.has_fuel_expenses) {
    if (row.fuel_vat_offset_mode === 'other' && row.fuel_vat_offset_custom_percent != null) {
      fuel_vat_label = `${row.fuel_vat_offset_custom_percent}%`;
    } else if (row.fuel_vat_offset_mode) {
      fuel_vat_label = FUEL_VAT_LABEL.get(row.fuel_vat_offset_mode) ?? row.fuel_vat_offset_mode;
    }
  } else {
    fuel_vat_label = 'לא';
  }
  return { license_plate: plate, ownership_label, assigned_label, fuel_vat_label };
}

export function vehicleFleetRowToListItem(row: VehicleFleetRow, canEdit: boolean): VehicleListItemDto {
  const { license_plate: plate, ownership_label: own, assigned_label: assigned, fuel_vat_label: fuelVat } =
    vehicleFleetRowSummaryFields(row);
  const lines: string[] = [
    `מספר רישוי: ${plate}`,
    `סוג בעלות: ${own}`,
    `למי משויך הרכב: ${assigned}`,
    `שיעור קיזוז מע״מ על דלק: ${fuelVat}`,
  ];
  return {
    vehicle_id: row.id,
    summary_lines: lines,
    edit_action: { label: 'עריכה', enabled: canEdit },
  };
}

/** @deprecated Legacy shape for callers that still expect id nullable + old keys; prefer VehicleFleetRow */
export function defaultVehicleFleetRowLegacy(): Record<string, unknown> {
  return {
    id: null,
    ownership: 'business',
    ownership_kind: 'business_vehicle',
    license_plate: null,
    license_file_asset_id: null,
    license_file_name: null,
    comprehensive_insurance_file_asset_id: null,
    comprehensive_insurance_file_name: null,
    compulsory_insurance_file_asset_id: null,
    compulsory_insurance_file_name: null,
    manufacture_year: null,
    vehicle_cost_ils: null,
    purchase_date: null,
    sale_date: null,
    sale_price_ils: null,
    vehicle_class: 'private_car',
    has_fuel_expenses: false,
    has_vehicle_insurance: false,
    notes: null,
  };
}

export function defaultVehicleDraft(): Record<string, unknown> {
  return {
    ownership_kind: 'business_vehicle',
    license_plate: null,
    license_file_asset_id: null,
    license_file_name: null,
    comprehensive_insurance_file_asset_id: null,
    comprehensive_insurance_file_name: null,
    compulsory_insurance_file_asset_id: null,
    compulsory_insurance_file_name: null,
    manufacturer: null,
    model: null,
    manufacture_year: null,
    purchase_date: null,
    vehicle_owner_name: null,
    assigned_to: null,
    recognized_in_business: null,
    vehicle_cost_ils: null,
    current_value_ils: null,
    acquisition_method: null,
    business_use_percent: null,
    has_fuel_expenses: false,
    fuel_vat_offset_mode: null,
    fuel_vat_offset_custom_percent: null,
    has_additional_vehicle_expenses: false,
    vehicle_exp_vat_offset_mode: null,
    vehicle_exp_vat_offset_custom_percent: null,
    vehicle_status: 'active',
    sale_date: null,
    sale_price_ils: null,
    notes: null,
  };
}

function rowToDraft(r: VehicleFleetRow): Record<string, unknown> {
  return {
    ownership_kind: r.ownership_kind,
    license_plate: r.license_plate,
    license_file_asset_id: r.license_file_asset_id,
    license_file_name: r.license_file_name,
    comprehensive_insurance_file_asset_id: r.comprehensive_insurance_file_asset_id,
    comprehensive_insurance_file_name: r.comprehensive_insurance_file_name,
    compulsory_insurance_file_asset_id: r.compulsory_insurance_file_asset_id,
    compulsory_insurance_file_name: r.compulsory_insurance_file_name,
    manufacturer: r.manufacturer,
    model: r.model,
    manufacture_year: r.manufacture_year,
    purchase_date: r.purchase_date,
    vehicle_owner_name: r.vehicle_owner_name,
    assigned_to: r.assigned_to,
    recognized_in_business: r.recognized_in_business,
    vehicle_cost_ils: r.vehicle_cost_ils,
    current_value_ils: r.current_value_ils,
    acquisition_method: r.acquisition_method,
    business_use_percent: r.business_use_percent,
    has_fuel_expenses: r.has_fuel_expenses,
    fuel_vat_offset_mode: r.fuel_vat_offset_mode,
    fuel_vat_offset_custom_percent: r.fuel_vat_offset_custom_percent,
    has_additional_vehicle_expenses: r.has_additional_vehicle_expenses,
    vehicle_exp_vat_offset_mode: r.vehicle_exp_vat_offset_mode,
    vehicle_exp_vat_offset_custom_percent: r.vehicle_exp_vat_offset_custom_percent,
    vehicle_status: r.vehicle_status,
    sale_date: r.sale_date,
    sale_price_ils: r.sale_price_ils,
    notes: r.notes,
  };
}

export function computeVehicleItemFieldVisibility(draft: Record<string, unknown>): Record<string, boolean> {
  const hasFuel = Boolean(draft.has_fuel_expenses);
  const fuelMode = String(draft.fuel_vat_offset_mode ?? '');
  const hasAdd = Boolean(draft.has_additional_vehicle_expenses);
  const expMode = String(draft.vehicle_exp_vat_offset_mode ?? '');
  const st = String(draft.vehicle_status ?? 'active');
  return {
    ownership_kind: true,
    license_plate: true,
    manufacturer: true,
    model: true,
    manufacture_year: true,
    purchase_date: true,
    vehicle_owner_name: true,
    assigned_to: true,
    recognized_in_business: true,
    vehicle_cost_ils: true,
    current_value_ils: true,
    acquisition_method: true,
    business_use_percent: true,
    has_fuel_expenses: true,
    fuel_vat_offset_mode: hasFuel,
    fuel_vat_offset_custom_percent: hasFuel && fuelMode === 'other',
    has_additional_vehicle_expenses: true,
    vehicle_exp_vat_offset_mode: hasAdd,
    vehicle_exp_vat_offset_custom_percent: hasAdd && expMode === 'other',
    vehicle_status: true,
    sale_date: st === 'sold',
    sale_price_ils: st === 'sold',
    notes: true,
    license_file_asset_id: true,
    comprehensive_insurance_file_asset_id: true,
    compulsory_insurance_file_asset_id: true,
  };
}

function buildVehicleItemFields(draft: Record<string, unknown>, canEdit: boolean): VehicleItemFieldSchema[] {
  const mk = (
    key: string,
    label: string,
    type: VehicleItemFieldSchema['type'],
    value: unknown,
    rest: Partial<VehicleItemFieldSchema> = {}
  ): VehicleItemFieldSchema => ({
    key,
    label,
    type,
    value,
    required: false,
    visible: true,
    editable: canEdit,
    ...rest,
  });

  return [
    mk('ownership_kind', 'סוג בעלות', 'enum_single', draft.ownership_kind, {
      group_label: 'פרטי רכב',
      options: OWNERSHIP_KIND_OPTS,
    }),
    mk('license_plate', 'מספר רישוי', 'text', draft.license_plate, { max_length: 32 }),
    mk('manufacturer', 'יצרן', 'text', draft.manufacturer, { max_length: 120 }),
    mk('model', 'דגם', 'text', draft.model, { max_length: 120 }),
    mk('manufacture_year', 'שנת ייצור', 'integer', draft.manufacture_year, {
      min: FLEET_MANUFACTURE_YEAR_MIN,
      max: FLEET_MANUFACTURE_YEAR_MAX,
    }),
    mk('purchase_date', 'תאריך רכישה / תחילת שימוש', 'date', draft.purchase_date),
    mk('vehicle_owner_name', 'שם בעל הרכב', 'text', draft.vehicle_owner_name, {
      group_label: 'שיוך',
      max_length: 200,
    }),
    mk('assigned_to', 'למי משויך הרכב', 'enum_single', draft.assigned_to, { options: ASSIGNED_TO_OPTS }),
    mk('recognized_in_business', 'האם הרכב מוכר בעסק', 'enum_single', draft.recognized_in_business, {
      options: RECOGNIZED_OPTS,
    }),
    mk('vehicle_cost_ils', 'עלות רכישה', 'numeric', draft.vehicle_cost_ils, {
      group_label: 'נתונים כספיים',
      min: 0,
    }),
    mk('current_value_ils', 'שווי נוכחי / שווי מוערך', 'numeric', draft.current_value_ils, { min: 0 }),
    mk('acquisition_method', 'אופן רכישה', 'enum_single', draft.acquisition_method, { options: ACQUISITION_OPTS }),
    mk('business_use_percent', 'אחוז שימוש עסקי', 'integer', draft.business_use_percent, {
      group_label: 'מס והוצאות',
      min: 0,
      max: 100,
    }),
    mk('has_fuel_expenses', 'האם יש הוצאות דלק', 'boolean', draft.has_fuel_expenses, {
      options: [
        { value: true, label: 'כן' },
        { value: false, label: 'לא' },
      ],
    }),
    mk('fuel_vat_offset_mode', 'שיעור קיזוז מע״מ על דלק', 'enum_single', draft.fuel_vat_offset_mode, {
      options: FUEL_VAT_OPTS,
    }),
    mk('fuel_vat_offset_custom_percent', 'אחוז קיזוז מע״מ דלק', 'numeric', draft.fuel_vat_offset_custom_percent, {
      min: 0,
      max: 100,
    }),
    mk('has_additional_vehicle_expenses', 'האם יש הוצאות רכב נוספות', 'boolean', draft.has_additional_vehicle_expenses, {
      options: [
        { value: true, label: 'כן' },
        { value: false, label: 'לא' },
      ],
    }),
    mk('vehicle_exp_vat_offset_mode', 'שיעור קיזוז מע״מ על הוצאות רכב', 'enum_single', draft.vehicle_exp_vat_offset_mode, {
      options: VEHICLE_EXP_VAT_OPTS,
    }),
    mk(
      'vehicle_exp_vat_offset_custom_percent',
      'אחוז קיזוז מע״מ הוצאות רכב',
      'numeric',
      draft.vehicle_exp_vat_offset_custom_percent,
      { min: 0, max: 100 }
    ),
    mk('vehicle_status', 'סטטוס רכב', 'enum_single', draft.vehicle_status, {
      group_label: 'סטטוס',
      options: VEHICLE_STATUS_OPTS,
    }),
    mk('sale_date', 'תאריך מכירה', 'date', draft.sale_date),
    mk('sale_price_ils', 'מחיר מכירה', 'numeric', draft.sale_price_ils, { min: 0 }),
    mk('notes', 'הערות על הרכב', 'textarea', draft.notes, { group_label: 'הערות', max_length: 2000 }),
    mk(
      'license_file_asset_id',
      'רישיון רכב (קובץ)',
      'vehicle_file',
      {
        asset_id: draft.license_file_asset_id ?? null,
        display_name: draft.license_file_name ?? null,
      },
      { group_label: 'מסמכים' }
    ),
    mk(
      'comprehensive_insurance_file_asset_id',
      'ביטוח מקיף (קובץ)',
      'vehicle_file',
      {
        asset_id: draft.comprehensive_insurance_file_asset_id ?? null,
        display_name: draft.comprehensive_insurance_file_name ?? null,
      },
      { group_label: 'מסמכים' }
    ),
    mk(
      'compulsory_insurance_file_asset_id',
      'ביטוח חובה (קובץ)',
      'vehicle_file',
      {
        asset_id: draft.compulsory_insurance_file_asset_id ?? null,
        display_name: draft.compulsory_insurance_file_name ?? null,
      },
      { group_label: 'מסמכים' }
    ),
  ];
}

function applyVisToVehicleFields(
  fields: VehicleItemFieldSchema[],
  visibility: Record<string, boolean>
): VehicleItemFieldSchema[] {
  return fields.map((f) => ({ ...f, visible: visibility[f.key] !== false }));
}

export async function getVehicleFleetItemModal(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  vehicleId: string | null,
  canEdit: boolean
): Promise<VehicleFleetItemModalResponse> {
  const parent = await ensureAccountingParent(orgId, clientId, ctx.user.id);
  const parentV = Number(parent.vehicles_version ?? 0);

  let draft: Record<string, unknown>;
  if (vehicleId) {
    const { data: row, error } = await supabaseAdmin
      .from('client_accounting_vehicle_fleet')
      .select('*')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .eq('id', vehicleId)
      .maybeSingle();
    if (error) throw new AppError(500, error.message ?? 'vehicle read failed', 'SUPABASE_ERROR');
    if (!row) throw forbidden('רכב לא נמצא');
    let mapped = mapRawRowToFleet(row as Record<string, unknown>);
    const fileIds = [
      mapped.license_file_asset_id,
      mapped.comprehensive_insurance_file_asset_id,
      mapped.compulsory_insurance_file_asset_id,
    ].filter(Boolean) as string[];
    const nameMap = await fetchFileNames(orgId, fileIds);
    mapped = {
      ...mapped,
      license_file_name: mapped.license_file_asset_id ? nameMap.get(mapped.license_file_asset_id) ?? null : null,
      comprehensive_insurance_file_name: mapped.comprehensive_insurance_file_asset_id
        ? nameMap.get(mapped.comprehensive_insurance_file_asset_id) ?? null
        : null,
      compulsory_insurance_file_name: mapped.compulsory_insurance_file_asset_id
        ? nameMap.get(mapped.compulsory_insurance_file_asset_id) ?? null
        : null,
    };
    draft = rowToDraft(mapped);
  } else {
    draft = defaultVehicleDraft();
  }

  const vis = computeVehicleItemFieldVisibility(draft);
  const fields = applyVisToVehicleFields(buildVehicleItemFields(draft, canEdit), vis);

  return {
    modal_key: 'accounting_settings_vehicle_item',
    modal_label: vehicleId ? 'עריכת רכב' : 'הוספת רכב',
    block_key: 'vehicles',
    vehicle_id: vehicleId,
    parent_vehicles_version: parentV,
    can_edit: canEdit,
    field_visibility: vis,
    fields,
  };
}

export async function evaluateVehicleItemModalVisibility(
  draft: Record<string, unknown>
): Promise<{ field_visibility: Record<string, boolean> }> {
  return { field_visibility: computeVehicleItemFieldVisibility(draft) };
}

function assertOrgCtx(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

async function ensureClientInOrgFleet(orgId: string, clientId: string): Promise<void> {
  const { data } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
  if (!data) throw forbidden('Client not found');
}

async function ensureAccountingParent(orgId: string, clientId: string, userId: string): Promise<Record<string, unknown>> {
  const { data: row, error } = await supabaseAdmin
    .from('client_accounting_settings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new AppError(500, error.message ?? 'client_accounting_settings read failed', 'SUPABASE_ERROR');
  if (row) return row as Record<string, unknown>;
  const { data: created, error: insErr } = await supabaseAdmin
    .from('client_accounting_settings')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      has_vehicles: false,
      has_business_vehicles: false,
      is_seasonal_business: false,
      created_by: userId,
      updated_by: userId,
    })
    .select('*')
    .single();
  if (insErr || !created) throw new AppError(500, insErr?.message ?? 'client_accounting_settings insert failed', 'SUPABASE_ERROR');
  return created as Record<string, unknown>;
}

function parseVehiclePayload(body: Record<string, unknown>): Record<string, unknown> {
  const ownership_kind = String(body.ownership_kind ?? '') as OwnershipKind;
  if (!OWNERSHIP_KIND_LABEL.has(ownership_kind)) throw badRequest('סוג בעלות לא חוקי');

  const plate =
    body.license_plate == null || String(body.license_plate).trim() === ''
      ? null
      : String(body.license_plate).trim();
  if (plate && plate.length > 32) throw badRequest('מספר רישוי ארוך מדי');

  const manufacturer = body.manufacturer == null ? null : String(body.manufacturer).trim() || null;
  const model = body.model == null ? null : String(body.model).trim() || null;
  if (manufacturer && manufacturer.length > 120) throw badRequest('יצרן ארוך מדי');
  if (model && model.length > 120) throw badRequest('דגם ארוך מדי');

  const y =
    body.manufacture_year == null || body.manufacture_year === ''
      ? null
      : Number(body.manufacture_year);
  if (y != null && (!Number.isFinite(y) || y < FLEET_MANUFACTURE_YEAR_MIN || y > FLEET_MANUFACTURE_YEAR_MAX)) {
    throw badRequest('שנת ייצור לא חוקית');
  }

  const purchase_date =
    body.purchase_date == null || body.purchase_date === '' ? null : String(body.purchase_date).slice(0, 10);
  const vehicle_owner_name =
    body.vehicle_owner_name == null ? null : String(body.vehicle_owner_name).trim() || null;
  if (vehicle_owner_name && vehicle_owner_name.length > 200) throw badRequest('שם בעל הרכב ארוך מדי');

  const assigned_to =
    body.assigned_to == null || body.assigned_to === ''
      ? null
      : (String(body.assigned_to) as AssignedTo);
  if (assigned_to && !ASSIGNED_TO_LABEL.has(assigned_to)) throw badRequest('שיוך לא חוקי');

  const recognized_in_business =
    body.recognized_in_business == null || body.recognized_in_business === ''
      ? null
      : (String(body.recognized_in_business) as RecognizedInBusiness);
  if (recognized_in_business && !RECOGNIZED_LABEL.has(recognized_in_business)) {
    throw badRequest('האם מוכר בעסק — ערך לא חוקי');
  }

  const vehicle_cost_ils =
    body.vehicle_cost_ils == null || body.vehicle_cost_ils === '' ? null : Number(body.vehicle_cost_ils);
  if (vehicle_cost_ils != null && (!Number.isFinite(vehicle_cost_ils) || vehicle_cost_ils < 0)) {
    throw badRequest('עלות רכישה לא חוקית');
  }

  const current_value_ils =
    body.current_value_ils == null || body.current_value_ils === '' ? null : Number(body.current_value_ils);
  if (current_value_ils != null && (!Number.isFinite(current_value_ils) || current_value_ils < 0)) {
    throw badRequest('שווי לא חוקי');
  }

  const acquisition_method =
    body.acquisition_method == null || body.acquisition_method === ''
      ? null
      : (String(body.acquisition_method) as AcquisitionMethod);
  if (acquisition_method && !ACQUISITION_LABEL.has(acquisition_method)) throw badRequest('אופן רכישה לא חוקי');

  const business_use_percent =
    body.business_use_percent == null || body.business_use_percent === ''
      ? null
      : Number(body.business_use_percent);
  if (
    business_use_percent != null &&
    (!Number.isFinite(business_use_percent) ||
      business_use_percent < 0 ||
      business_use_percent > 100 ||
      Math.round(business_use_percent) !== business_use_percent)
  ) {
    throw badRequest('אחוז שימוש עסקי חייב להיות שלם 0–100');
  }

  const has_fuel_expenses = Boolean(body.has_fuel_expenses);
  let fuel_vat_offset_mode: FuelVatOffsetMode | null =
    body.fuel_vat_offset_mode == null || body.fuel_vat_offset_mode === ''
      ? null
      : (String(body.fuel_vat_offset_mode) as FuelVatOffsetMode);
  if (!has_fuel_expenses) {
    fuel_vat_offset_mode = null;
  } else if (fuel_vat_offset_mode && !FUEL_VAT_LABEL.has(fuel_vat_offset_mode)) {
    throw badRequest('שיעור קיזוז מע״מ דלק לא חוקי');
  }
  if (has_fuel_expenses && !fuel_vat_offset_mode) throw badRequest('נא לבחור שיעור קיזוז מע״מ דלק');

  let fuel_vat_offset_custom_percent: number | null =
    body.fuel_vat_offset_custom_percent == null || body.fuel_vat_offset_custom_percent === ''
      ? null
      : Number(body.fuel_vat_offset_custom_percent);
  if (fuel_vat_offset_mode !== 'other') fuel_vat_offset_custom_percent = null;
  if (
    fuel_vat_offset_mode === 'other' &&
    (fuel_vat_offset_custom_percent == null ||
      !Number.isFinite(fuel_vat_offset_custom_percent) ||
      fuel_vat_offset_custom_percent < 0 ||
      fuel_vat_offset_custom_percent > 100)
  ) {
    throw badRequest('נא להזין אחוז קיזוז מע״מ דלק');
  }

  const has_additional_vehicle_expenses = Boolean(body.has_additional_vehicle_expenses);
  let vehicle_exp_vat_offset_mode: VehicleExpVatOffsetMode | null =
    body.vehicle_exp_vat_offset_mode == null || body.vehicle_exp_vat_offset_mode === ''
      ? null
      : (String(body.vehicle_exp_vat_offset_mode) as VehicleExpVatOffsetMode);
  if (!has_additional_vehicle_expenses) {
    vehicle_exp_vat_offset_mode = null;
  } else if (vehicle_exp_vat_offset_mode && !VEHICLE_EXP_VAT_LABEL.has(vehicle_exp_vat_offset_mode)) {
    throw badRequest('שיעור קיזוז מע״מ הוצאות רכב לא חוקי');
  }
  if (has_additional_vehicle_expenses && !vehicle_exp_vat_offset_mode) {
    throw badRequest('נא לבחור שיעור קיזוז מע״מ הוצאות רכב');
  }

  let vehicle_exp_vat_offset_custom_percent: number | null =
    body.vehicle_exp_vat_offset_custom_percent == null || body.vehicle_exp_vat_offset_custom_percent === ''
      ? null
      : Number(body.vehicle_exp_vat_offset_custom_percent);
  if (vehicle_exp_vat_offset_mode !== 'other') vehicle_exp_vat_offset_custom_percent = null;
  if (
    vehicle_exp_vat_offset_mode === 'other' &&
    (vehicle_exp_vat_offset_custom_percent == null ||
      !Number.isFinite(vehicle_exp_vat_offset_custom_percent) ||
      vehicle_exp_vat_offset_custom_percent < 0 ||
      vehicle_exp_vat_offset_custom_percent > 100)
  ) {
    throw badRequest('נא להזין אחוז קיזוז מע״מ הוצאות רכב');
  }

  const vehicle_status = String(body.vehicle_status ?? 'active') as VehicleStatus;
  if (!VEHICLE_STATUS_LABEL.has(vehicle_status)) throw badRequest('סטטוס רכב לא חוקי');

  let sale_date = body.sale_date == null || body.sale_date === '' ? null : String(body.sale_date).slice(0, 10);
  let sale_price_ils =
    body.sale_price_ils == null || body.sale_price_ils === '' ? null : Number(body.sale_price_ils);
  if (vehicle_status !== 'sold') {
    sale_date = null;
    sale_price_ils = null;
  } else {
    if (!sale_date) throw badRequest('נא להזין תאריך מכירה');
    if (sale_price_ils == null || !Number.isFinite(sale_price_ils) || sale_price_ils < 0) {
      throw badRequest('נא להזין מחיר מכירה');
    }
  }

  const notes = body.notes == null || String(body.notes).trim() === '' ? null : String(body.notes).trim();
  if (notes && notes.length > 2000) throw badRequest('הערות ארוכות מדי');

  const uuidOrNullFile = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    const s = String(v);
    return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
  };
  const license_file_asset_id = uuidOrNullFile(body.license_file_asset_id);
  const comprehensive_insurance_file_asset_id = uuidOrNullFile(body.comprehensive_insurance_file_asset_id);
  const compulsory_insurance_file_asset_id = uuidOrNullFile(body.compulsory_insurance_file_asset_id);

  return {
    ownership_kind,
    license_plate: plate,
    manufacturer,
    model,
    manufacture_year: y,
    purchase_date,
    vehicle_owner_name,
    assigned_to,
    recognized_in_business,
    vehicle_cost_ils,
    current_value_ils,
    acquisition_method,
    business_use_percent,
    has_fuel_expenses,
    fuel_vat_offset_mode,
    fuel_vat_offset_custom_percent,
    has_additional_vehicle_expenses,
    vehicle_exp_vat_offset_mode,
    vehicle_exp_vat_offset_custom_percent,
    vehicle_status,
    sale_date,
    sale_price_ils,
    notes,
    license_file_asset_id,
    comprehensive_insurance_file_asset_id,
    compulsory_insurance_file_asset_id,
  };
}

function dbPayloadFromParsed(
  orgId: string,
  clientId: string,
  sort_order: number,
  p: Record<string, unknown>
): Record<string, unknown> {
  const kind = p.ownership_kind as OwnershipKind;
  return {
    organization_id: orgId,
    client_id: clientId,
    sort_order,
    ownership: ownershipLegacyFromKind(kind),
    ownership_kind: kind,
    license_plate: p.license_plate,
    manufacturer: p.manufacturer,
    model: p.model,
    manufacture_year: p.manufacture_year,
    vehicle_cost_ils: p.vehicle_cost_ils,
    purchase_date: p.purchase_date,
    vehicle_owner_name: p.vehicle_owner_name,
    assigned_to: p.assigned_to,
    recognized_in_business: p.recognized_in_business,
    current_value_ils: p.current_value_ils,
    acquisition_method: p.acquisition_method,
    business_use_percent: p.business_use_percent,
    has_fuel_expenses: p.has_fuel_expenses,
    fuel_vat_offset_mode: p.fuel_vat_offset_mode,
    fuel_vat_offset_custom_percent: p.fuel_vat_offset_custom_percent,
    has_additional_vehicle_expenses: p.has_additional_vehicle_expenses,
    vehicle_exp_vat_offset_mode: p.vehicle_exp_vat_offset_mode,
    vehicle_exp_vat_offset_custom_percent: p.vehicle_exp_vat_offset_custom_percent,
    vehicle_status: p.vehicle_status,
    sale_date: p.sale_date,
    sale_price_ils: p.sale_price_ils,
    notes: p.notes,
    license_file_asset_id: p.license_file_asset_id ?? null,
    comprehensive_insurance_file_asset_id: p.comprehensive_insurance_file_asset_id ?? null,
    compulsory_insurance_file_asset_id: p.compulsory_insurance_file_asset_id ?? null,
    vehicle_class: 'private_car',
    has_vehicle_insurance: false,
  };
}

async function nextFleetSortOrder(orgId: string, clientId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .select('sort_order')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError(500, error.message ?? 'sort read failed', 'SUPABASE_ERROR');
  const max = (data as { sort_order?: number } | null)?.sort_order;
  return max == null ? 0 : max + 1;
}

async function bumpParentVehiclesVersion(
  orgId: string,
  clientId: string,
  userId: string,
  expectedVersion: number
): Promise<void> {
  const { data: updated, error } = await supabaseAdmin
    .from('client_accounting_settings')
    .update({ vehicles_version: expectedVersion + 1, updated_by: userId })
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('vehicles_version', expectedVersion)
    .select('id')
    .maybeSingle();
  if (error) throw new AppError(500, error.message ?? 'version bump failed', 'SUPABASE_ERROR');
  if (!updated) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
}

export async function createVehicleFleetItem(
  ctx: RequestContext,
  clientId: string,
  body: Record<string, unknown>
): Promise<void> {
  const orgId = assertOrgCtx(ctx);
  await ensureClientInOrgFleet(orgId, clientId);
  const expected = body.expected_vehicles_version;
  if (expected == null || !Number.isFinite(Number(expected))) throw badRequest('expected_vehicles_version נדרש');
  const expectedV = Number(expected);
  const parent = await ensureAccountingParent(orgId, clientId, ctx.user.id);
  const currentV = Number(parent?.vehicles_version ?? 0);
  if (expectedV !== currentV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');

  const hasVehicles = Boolean(parent?.has_vehicles);
  if (!hasVehicles) throw badRequest('יש לסמן "יש רכבים" לפני הוספת רכב');

  const { count, error: cErr } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
  if (cErr) throw new AppError(500, cErr.message ?? 'count failed', 'SUPABASE_ERROR');
  if ((count ?? 0) >= MAX_VEHICLES_PER_CLIENT) throw badRequest(`ניתן לשמור עד ${MAX_VEHICLES_PER_CLIENT} רכבים`);

  const parsed = parseVehiclePayload(body);
  const sortOrder = await nextFleetSortOrder(orgId, clientId);
  const row = dbPayloadFromParsed(orgId, clientId, sortOrder, parsed);
  const { error: insErr } = await supabaseAdmin.from('client_accounting_vehicle_fleet').insert(row);
  if (insErr) throw new AppError(500, insErr.message ?? 'insert vehicle failed', 'SUPABASE_ERROR');

  await bumpParentVehiclesVersion(orgId, clientId, ctx.user.id, currentV);

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_accounting_vehicle_fleet',
    entityId: clientId,
    action: AUDIT_ACTIONS.ACCOUNTING_SETTINGS_VEHICLES_UPDATED,
    payload: { op: 'create_vehicle' },
  });
}

export async function updateVehicleFleetItem(
  ctx: RequestContext,
  clientId: string,
  vehicleId: string,
  body: Record<string, unknown>
): Promise<void> {
  const orgId = assertOrgCtx(ctx);
  await ensureClientInOrgFleet(orgId, clientId);
  const expected = body.expected_vehicles_version;
  if (expected == null || !Number.isFinite(Number(expected))) throw badRequest('expected_vehicles_version נדרש');
  const expectedV = Number(expected);
  const parent = await ensureAccountingParent(orgId, clientId, ctx.user.id);
  const currentV = Number(parent?.vehicles_version ?? 0);
  if (expectedV !== currentV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');

  const { data: existing, error: exErr } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .select('id, sort_order')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', vehicleId)
    .maybeSingle();
  if (exErr) throw new AppError(500, exErr.message ?? 'vehicle lookup failed', 'SUPABASE_ERROR');
  if (!existing) throw forbidden('רכב לא נמצא');

  const parsed = parseVehiclePayload(body);
  const sortOrder = (existing as { sort_order: number }).sort_order;
  const full = dbPayloadFromParsed(orgId, clientId, sortOrder, parsed);
  const { organization_id: _org, client_id: _cli, ...patch } = full;
  void _org;
  void _cli;
  const { error: upErr } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .update(patch)
    .eq('id', vehicleId)
    .eq('organization_id', orgId);
  if (upErr) throw new AppError(500, upErr.message ?? 'update vehicle failed', 'SUPABASE_ERROR');

  await bumpParentVehiclesVersion(orgId, clientId, ctx.user.id, currentV);

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_accounting_vehicle_fleet',
    entityId: vehicleId,
    action: AUDIT_ACTIONS.ACCOUNTING_SETTINGS_VEHICLES_UPDATED,
    payload: { op: 'update_vehicle', client_id: clientId },
  });
}

export async function deleteVehicleFleetItem(
  ctx: RequestContext,
  clientId: string,
  vehicleId: string,
  body: Record<string, unknown>
): Promise<void> {
  const orgId = assertOrgCtx(ctx);
  await ensureClientInOrgFleet(orgId, clientId);
  const expected = body.expected_vehicles_version;
  if (expected == null || !Number.isFinite(Number(expected))) throw badRequest('expected_vehicles_version נדרש');
  const expectedV = Number(expected);
  const parent = await ensureAccountingParent(orgId, clientId, ctx.user.id);
  const currentV = Number(parent?.vehicles_version ?? 0);
  if (expectedV !== currentV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');

  const { data: existing, error: exErr } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', vehicleId)
    .maybeSingle();
  if (exErr) throw new AppError(500, exErr.message ?? 'vehicle lookup failed', 'SUPABASE_ERROR');
  if (!existing) throw forbidden('רכב לא נמצא');

  const { error: delErr } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .delete()
    .eq('id', vehicleId)
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
  if (delErr) throw new AppError(500, delErr.message ?? 'delete vehicle failed', 'SUPABASE_ERROR');

  await bumpParentVehiclesVersion(orgId, clientId, ctx.user.id, currentV);

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_accounting_vehicle_fleet',
    entityId: vehicleId,
    action: AUDIT_ACTIONS.ACCOUNTING_SETTINGS_VEHICLES_UPDATED,
    payload: { op: 'delete_vehicle', client_id: clientId },
  });
}

function mapRawRowToFleet(r: Record<string, unknown>): VehicleFleetRow {
  const ownership_kind = (r.ownership_kind as OwnershipKind) ?? 'business_vehicle';
  return {
    id: String(r.id),
    sort_order: Number(r.sort_order ?? 0),
    ownership_kind: OWNERSHIP_KIND_LABEL.has(ownership_kind) ? ownership_kind : 'business_vehicle',
    license_plate: r.license_plate == null ? null : String(r.license_plate),
    manufacturer: r.manufacturer == null ? null : String(r.manufacturer),
    model: r.model == null ? null : String(r.model),
    manufacture_year: r.manufacture_year == null ? null : Number(r.manufacture_year),
    vehicle_cost_ils: r.vehicle_cost_ils == null ? null : Number(r.vehicle_cost_ils),
    purchase_date: r.purchase_date == null ? null : String(r.purchase_date),
    vehicle_owner_name: r.vehicle_owner_name == null ? null : String(r.vehicle_owner_name),
    assigned_to: r.assigned_to == null ? null : (String(r.assigned_to) as AssignedTo),
    recognized_in_business: r.recognized_in_business == null ? null : (String(r.recognized_in_business) as RecognizedInBusiness),
    current_value_ils: r.current_value_ils == null ? null : Number(r.current_value_ils),
    acquisition_method: r.acquisition_method == null ? null : (String(r.acquisition_method) as AcquisitionMethod),
    business_use_percent: r.business_use_percent == null ? null : Number(r.business_use_percent),
    has_fuel_expenses: Boolean(r.has_fuel_expenses),
    fuel_vat_offset_mode: r.fuel_vat_offset_mode == null ? null : (String(r.fuel_vat_offset_mode) as FuelVatOffsetMode),
    fuel_vat_offset_custom_percent:
      r.fuel_vat_offset_custom_percent == null ? null : Number(r.fuel_vat_offset_custom_percent),
    has_additional_vehicle_expenses: Boolean(r.has_additional_vehicle_expenses),
    vehicle_exp_vat_offset_mode:
      r.vehicle_exp_vat_offset_mode == null ? null : (String(r.vehicle_exp_vat_offset_mode) as VehicleExpVatOffsetMode),
    vehicle_exp_vat_offset_custom_percent:
      r.vehicle_exp_vat_offset_custom_percent == null ? null : Number(r.vehicle_exp_vat_offset_custom_percent),
    vehicle_status: (VEHICLE_STATUS_LABEL as Map<string, string>).has(String(r.vehicle_status))
      ? (String(r.vehicle_status) as VehicleStatus)
      : 'active',
    sale_date: r.sale_date == null ? null : String(r.sale_date),
    sale_price_ils: r.sale_price_ils == null ? null : Number(r.sale_price_ils),
    notes: r.notes == null ? null : String(r.notes),
    license_file_asset_id: r.license_file_asset_id == null ? null : String(r.license_file_asset_id),
    license_file_name: null,
    comprehensive_insurance_file_asset_id:
      r.comprehensive_insurance_file_asset_id == null ? null : String(r.comprehensive_insurance_file_asset_id),
    comprehensive_insurance_file_name: null,
    compulsory_insurance_file_asset_id:
      r.compulsory_insurance_file_asset_id == null ? null : String(r.compulsory_insurance_file_asset_id),
    compulsory_insurance_file_name: null,
  };
}

async function fetchFileNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data, error } = await supabaseAdmin.from('file_assets').select('id, file_name').eq('organization_id', orgId).in('id', uniq);
  if (error) throw new AppError(500, error.message ?? 'file_assets read failed', 'SUPABASE_ERROR');
  const m = new Map<string, string>();
  for (const r of data ?? []) m.set(String((r as any).id), String((r as any).file_name ?? ''));
  return m;
}

export async function loadVehicleFleet(orgId: string, clientId: string): Promise<VehicleFleetRow[]> {
  const { data, error } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
  if (error) throw new AppError(500, error.message ?? 'vehicle_fleet read failed', 'SUPABASE_ERROR');
  const rows = (data ?? []) as Record<string, unknown>[];
  const fileIds: string[] = [];
  for (const r of rows) {
    if (r.license_file_asset_id) fileIds.push(String(r.license_file_asset_id));
    if (r.comprehensive_insurance_file_asset_id) fileIds.push(String(r.comprehensive_insurance_file_asset_id));
    if (r.compulsory_insurance_file_asset_id) fileIds.push(String(r.compulsory_insurance_file_asset_id));
  }
  const names = await fetchFileNames(orgId, fileIds);
  const mapped = rows.map((r) => {
    const base = mapRawRowToFleet(r);
    return {
      ...base,
      license_file_name: base.license_file_asset_id ? names.get(base.license_file_asset_id) ?? null : null,
      comprehensive_insurance_file_name: base.comprehensive_insurance_file_asset_id
        ? names.get(base.comprehensive_insurance_file_asset_id) ?? null
        : null,
      compulsory_insurance_file_name: base.compulsory_insurance_file_asset_id
        ? names.get(base.compulsory_insurance_file_asset_id) ?? null
        : null,
    };
  });
  return sortFleetRows(mapped);
}

const OWN = new Set(['business', 'private']);
const VCLASS = new Set(['private_car', 'commercial', 'motorcycle']);

export async function replaceVehicleFleet(
  orgId: string,
  clientId: string,
  hasVehicles: boolean,
  items: unknown[]
): Promise<void> {
  const { error: delErr } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .delete()
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
  if (delErr) throw new AppError(500, delErr.message ?? 'vehicle_fleet delete failed', 'SUPABASE_ERROR');

  if (!hasVehicles || !Array.isArray(items) || items.length === 0) return;

  if (items.length > 15) throw badRequest('Too many vehicles');

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Record<string, unknown>;
    const ownership = String(it.ownership ?? '');
    const vclass = String(it.vehicle_class ?? '');
    if (!OWN.has(ownership)) throw badRequest('Invalid vehicle ownership');
    if (!VCLASS.has(vclass)) throw badRequest('Invalid vehicle_class');
    const plate = it.license_plate == null || String(it.license_plate).trim() === '' ? null : String(it.license_plate).trim();
    if (plate && plate.length > 32) throw badRequest('license_plate too long');
    const y = it.manufacture_year == null || it.manufacture_year === '' ? null : Number(it.manufacture_year);
    if (y != null && (!Number.isFinite(y) || y < 1950 || y > 2100)) throw badRequest('Invalid manufacture_year');
    const notes = it.notes == null || String(it.notes).trim() === '' ? null : String(it.notes).trim();
    if (notes && notes.length > 2000) throw badRequest('notes too long');

    const uuidOrNull = (v: unknown): string | null => {
      if (v == null || v === '') return null;
      const s = String(v);
      return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
    };

    const ownership_kind: OwnershipKind = ownership === 'private' ? 'private_vehicle' : 'business_vehicle';
    const sale_date =
      it.sale_date == null || it.sale_date === '' ? null : String(it.sale_date).slice(0, 10);
    rows.push({
      organization_id: orgId,
      client_id: clientId,
      sort_order: i,
      ownership,
      ownership_kind,
      license_plate: plate,
      manufacturer: null,
      model: null,
      license_file_asset_id: uuidOrNull(it.license_file_asset_id),
      comprehensive_insurance_file_asset_id: uuidOrNull(it.comprehensive_insurance_file_asset_id),
      compulsory_insurance_file_asset_id: uuidOrNull(it.compulsory_insurance_file_asset_id),
      manufacture_year: y,
      vehicle_cost_ils: it.vehicle_cost_ils == null || it.vehicle_cost_ils === '' ? null : Number(it.vehicle_cost_ils),
      purchase_date: it.purchase_date == null || it.purchase_date === '' ? null : String(it.purchase_date),
      sale_date,
      sale_price_ils: it.sale_price_ils == null || it.sale_price_ils === '' ? null : Number(it.sale_price_ils),
      vehicle_class: vclass,
      vehicle_owner_name: null,
      assigned_to: null,
      recognized_in_business: null,
      current_value_ils: null,
      acquisition_method: null,
      business_use_percent: null,
      fuel_vat_offset_mode: null,
      fuel_vat_offset_custom_percent: null,
      has_additional_vehicle_expenses: false,
      vehicle_exp_vat_offset_mode: null,
      vehicle_exp_vat_offset_custom_percent: null,
      vehicle_status: sale_date ? 'sold' : 'active',
      has_fuel_expenses: Boolean(it.has_fuel_expenses),
      has_vehicle_insurance: Boolean(it.has_vehicle_insurance),
      notes,
    });
  }

  const { error: insErr } = await supabaseAdmin.from('client_accounting_vehicle_fleet').insert(rows);
  if (insErr) throw new AppError(500, insErr.message ?? 'vehicle_fleet insert failed', 'SUPABASE_ERROR');
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    console.warn('[vehicle-fleet] bucket:', error.message);
  }
  bucketEnsured = true;
}

export async function uploadVehicleFleetDocument(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: { file_base64?: string; file_name?: string; mime_type?: string | null }
): Promise<{ file_asset_id: string; file_name: string }> {
  const fileName = String(body.file_name ?? '').trim();
  if (!fileName) throw badRequest('file_name is required');
  const b64 = body.file_base64;
  if (typeof b64 !== 'string' || !b64.length) throw badRequest('file_base64 is required');
  if (b64.length > MAX_B64) throw badRequest('File too large');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  await ensureBucket();
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_FILE) throw badRequest('File too large');
  const storageKey = `${orgId}/vehicle-fleet/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storageKey, buf, {
    contentType: body.mime_type ?? 'application/octet-stream',
    upsert: false,
  });
  if (upErr) throw new AppError(500, upErr.message ?? 'upload failed', 'SUPABASE_ERROR');

  const { data: asset, error: faErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: orgId,
      storage_provider: 'supabase',
      storage_key: storageKey,
      file_name: fileName,
      mime_type: body.mime_type ?? null,
      file_size: buf.length,
      uploaded_by: ctx.user.id,
      access_level: 'organization',
    })
    .select('id, file_name')
    .single();
  if (faErr || !asset) throw new AppError(500, faErr?.message ?? 'file_assets insert failed', 'SUPABASE_ERROR');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_vehicle_fleet_file',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: { client_id: clientId, file_asset_id: (asset as any).id },
  });

  return { file_asset_id: String((asset as any).id), file_name: String((asset as any).file_name ?? fileName) };
}

export async function assertVehicleFleetFileAccess(orgId: string, clientId: string, fileAssetId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('client_accounting_vehicle_fleet')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .or(
      `license_file_asset_id.eq.${fileAssetId},comprehensive_insurance_file_asset_id.eq.${fileAssetId},compulsory_insurance_file_asset_id.eq.${fileAssetId}`
    )
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError(500, error.message ?? 'fleet file check failed', 'SUPABASE_ERROR');
  if (!data) throw forbidden('File not linked to this client vehicle fleet');
}

/** Allows preview before save: file must be linked to a fleet row OR uploaded under this client’s vehicle-fleet prefix. */
export async function assertVehicleFleetFileOpenAllowed(
  orgId: string,
  clientId: string,
  fileAssetId: string
): Promise<void> {
  try {
    await assertVehicleFleetFileAccess(orgId, clientId, fileAssetId);
    return;
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 403) throw e;
    // Pending upload — not linked yet; check storage prefix below
  }
  const { data: fileAsset, error } = await supabaseAdmin
    .from('file_assets')
    .select('organization_id, storage_key')
    .eq('id', fileAssetId)
    .single();
  if (error || !fileAsset) throw forbidden('File not found');
  const fa = fileAsset as { organization_id: string; storage_key: string };
  if (fa.organization_id !== orgId) throw forbidden('File not found');
  const prefix = `${orgId}/vehicle-fleet/${clientId}/`;
  if (!String(fa.storage_key).startsWith(prefix)) throw forbidden('File not linked to this client vehicle fleet');
}

const SIGNED_URL_SEC = 120;

export async function getVehicleFleetFileOpenUrl(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  fileAssetId: string
): Promise<{ url: string }> {
  await assertVehicleFleetFileOpenAllowed(orgId, clientId, fileAssetId);
  const { data: fileAsset, error } = await supabaseAdmin
    .from('file_assets')
    .select('storage_key, organization_id')
    .eq('id', fileAssetId)
    .single();
  if (error || !fileAsset || (fileAsset as { organization_id?: string }).organization_id !== orgId) {
    throw forbidden('File not found');
  }
  await ensureBucket();
  const { data: signed, error: se } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl((fileAsset as { storage_key: string }).storage_key, SIGNED_URL_SEC);
  if (se || !signed?.signedUrl) throw new AppError(500, se?.message ?? 'signed url failed', 'SUPABASE_ERROR');
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_vehicle_fleet_file',
    entityId: fileAssetId,
    action: AUDIT_ACTIONS.CLIENT_FILE_VIEWED,
    payload: { client_id: clientId },
  });
  return { url: signed.signedUrl };
}
