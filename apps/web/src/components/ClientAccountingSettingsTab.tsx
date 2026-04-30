import type { ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import {
  moduleClientOperationsAccountingCommands,
  moduleClientOperationsAccountingVehicleFleetFileOpen,
  moduleClientOperationsAccountingVehicleFleetUpload,
  moduleClientOperationsAccountingSettingsBlockModal,
  moduleClientOperationsAccountingSettingsBlockNormalizeDraft,
  moduleClientOperationsAccountingSettingsModalVisibility,
  moduleClientOperationsVehicleFleetItemModal,
  moduleClientOperationsVehicleFleetItemModalVisibility,
} from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';

type VehicleFleetUploadApiResponse = {
  file_asset_id: string;
  file_name: string;
  client_operations_case: ClientOperationsCaseResponse;
};

type BlockKey = 'expenses' | 'income' | 'expense_management' | 'documents' | 'vehicles';

/** Custom field types that require per-option names (aligned with server enum_single / enum_multi). */
const EM_ADD_FIELD_TYPES_NEED_OPTIONS = ['enum_single', 'enum_multi'] as const;

const EM_ADD_OPTIONS_MAX_FALLBACK = 8;

function expenseMgmtAddFieldNeedsOptions(fieldType: string): boolean {
  return (EM_ADD_FIELD_TYPES_NEED_OPTIONS as readonly string[]).includes(fieldType);
}

function emptyEmOptionRows(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, () => '');
}

type Option = { value: string | number | boolean; label: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      const b64 = s.includes('base64,') ? (s.split('base64,')[1] ?? '') : s;
      resolve(b64);
    };
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function vehicleFileDisplayNameKey(assetFieldKey: string): string {
  if (assetFieldKey === 'license_file_asset_id') return 'license_file_name';
  if (assetFieldKey === 'comprehensive_insurance_file_asset_id') return 'comprehensive_insurance_file_name';
  return 'compulsory_insurance_file_name';
}

type FieldSchema = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'enum_single'
    | 'enum_multi'
    | 'boolean'
    | 'integer'
    | 'numeric'
    | 'secure_text'
    | 'date'
    | 'vehicle_file';
  value: unknown;
  options?: Option[];
  required: boolean;
  visible: boolean;
  editable: boolean;
  placeholder?: string;
  max_length?: number;
  min?: number;
  max?: number;
  group_label?: string;
  display_as?: 'radio';
};

/** Modal API returns nested `value` for vehicle_file; draft + save expect flat asset id + file name keys. */
function draftFromVehicleModalFields(fields: FieldSchema[]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === 'vehicle_file') {
      const obj = (f.value as { asset_id?: string | null; display_name?: string | null }) ?? {};
      d[f.key] = obj.asset_id ?? null;
      d[vehicleFileDisplayNameKey(f.key)] = obj.display_name ?? null;
    } else {
      d[f.key] = f.value;
    }
  }
  return d;
}

/** מודאל ניהול הוצאות: שמאל — גישה לתוכנה בלבד; ימין — שדות תפעול (כולל רמת סדר) + שדות מותאמים */
const EXPENSE_MANAGEMENT_MODAL_LEFT_KEYS: readonly string[] = [
  'expense_software_name',
  'expense_software_username',
  'expense_software_password',
  'expense_software_url',
];
const EXPENSE_MANAGEMENT_MODAL_RIGHT_KEYS: readonly string[] = [
  'expense_delivery_method',
  'expense_uploaded_by',
  'expense_documents_order_level',
  'expense_management_notes',
];

type BlockSummaryDisplay = 'text' | 'link' | 'password_saved';

type VehiclesYesNoFieldDto = {
  field_key: 'has_vehicles';
  label: string;
  value: 'yes' | 'no';
  options: { value: 'yes' | 'no'; label: string }[];
};

type VehicleListItemDto = {
  vehicle_id: string;
  summary_lines: string[];
  edit_action?: { label: string; enabled: boolean };
};

type VehicleBlockActionDto = {
  action_key: 'add_vehicle' | 'edit_vehicle';
  label: string;
  enabled: boolean;
  vehicle_id?: string;
};

type VehicleFleetItemModalResponse = {
  modal_key: 'accounting_settings_vehicle_item';
  modal_label: string;
  block_key: 'vehicles';
  vehicle_id: string | null;
  parent_vehicles_version: number;
  can_edit: boolean;
  field_visibility: Record<string, boolean>;
  fields: FieldSchema[];
};

type AccountingExcelGridCell = {
  field_key: string;
  label: string;
  value: string;
  display?: BlockSummaryDisplay;
  visible: boolean;
};

type AccountingExcelGridRow = {
  left: AccountingExcelGridCell;
  right: AccountingExcelGridCell;
  vehicle_id?: string;
};

type AccountingBlockCard = {
  block_key: BlockKey;
  block_label: string;
  summary_text: string;
  summary_primary_rows: string[];
  summary_empty_state_text: string;
  summary_secondary_empty_message: string | null;
  summary_items: Array<{ label: string; value: string; display?: BlockSummaryDisplay }>;
  can_edit: boolean;
  edit_action: { type: 'open_modal'; modal_key: string };
  version: number;
  has_vehicles?: boolean;
  vehicles_yes_no?: VehiclesYesNoFieldDto;
  vehicle_items?: VehicleListItemDto[];
  vehicle_block_actions?: VehicleBlockActionDto[];
  excel_grid?: {
    column_headers: [string, string];
    rows: AccountingExcelGridRow[];
  };
  expense_management_zones?: {
    access: AccountingExcelGridCell[];
    main_column: AccountingExcelGridCell[];
  };
};

function AccountingSummaryItemValue({ it }: { it: AccountingBlockCard['summary_items'][number] }) {
  if (!it.value && it.display !== 'password_saved') return <span>—</span>;
  if (it.display === 'link') {
    return (
      <a href={String(it.value)} target="_blank" rel="noreferrer">
        פתיחת תוכנה
      </a>
    );
  }
  if (it.display === 'password_saved') {
    return <span>{it.value || 'שמורה'}</span>;
  }
  return <span>{it.value}</span>;
}

function ExcelGridCellValue({ cell }: { cell: AccountingExcelGridCell | undefined }) {
  if (!cell || !cell.visible) return <span>לא הוגדר</span>;
  return <AccountingSummaryItemValue it={{ label: '', value: cell.value, display: cell.display }} />;
}

function ExpenseManagementZonesPanel({
  zones,
}: {
  zones: NonNullable<AccountingBlockCard['expense_management_zones']>;
}) {
  const hasAccess = zones.access.length > 0;

  return (
    <div className={hasAccess ? 'nx-em-two-col' : 'nx-em-two-col nx-em-two-col--right-only'}>
      {hasAccess ? (
        <div className="nx-em-col nx-em-col-access" dir="rtl">
          <div className="nx-income-table">
            {zones.access.map((c) => (
              <div key={c.field_key} className="nx-income-table-row nx-income-table-row-split">
                <span>{c.visible ? c.label : 'לא הוגדר'}</span>
                <ExcelGridCellValue cell={c} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="nx-em-col nx-em-col-ops" dir="rtl">
        <div className="nx-income-table">
          {zones.main_column.map((c) => (
            <div key={c.field_key} className="nx-income-table-row nx-income-table-row-split">
              <span>{c.visible ? c.label : 'לא הוגדר'}</span>
              <ExcelGridCellValue cell={c} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export type AccountingTabResponse = {
  tab_key: 'accounting_settings';
  tab_label: string;
  layout: { type: 'grid'; columns: 2 };
  blocks: AccountingBlockCard[];
};

type AccountingBlockModalResponse = {
  modal_key: string;
  modal_label: string;
  block_key: BlockKey;
  version: number;
  can_edit: boolean;
  field_visibility?: Record<string, boolean>;
  fields: FieldSchema[];
  expense_management_modal_meta?: {
    custom_field_capacity: number;
    custom_field_count: number;
    custom_field_type_default: string | null;
    custom_field_type_placeholder_he: string;
    custom_field_type_options: Option[];
    custom_field_types_requiring_options: string[];
    custom_field_options_max_count?: number;
    custom_field_options_count_label_he?: string;
    custom_field_option_value_label_he?: string;
  };
};

/** Merge server field_visibility with per-field flags so keys never disappear (custom em_cf_* included). */
function visibilityFromModal(m: AccountingBlockModalResponse): Record<string, boolean> {
  const fromFields = Object.fromEntries(m.fields.map((f) => [f.key, f.visible]));
  return { ...fromFields, ...(m.field_visibility ?? {}) };
}

function buildDraftFromModal(out: AccountingBlockModalResponse): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const f of out.fields) d[f.key] = f.value;
  return d;
}

export function ClientAccountingSettingsTab({
  clientId,
  initialAccountingTab,
  onAccountingCaseUpdated,
}: {
  clientId: string;
  /** Workspace aggregate read model; null = no view permission. */
  initialAccountingTab: AccountingTabResponse | null;
  /** After accounting command — full case replace (NodexPro truth flow). */
  onAccountingCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const [tab, setTab] = useState<AccountingTabResponse | null>(() => initialAccountingTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<AccountingBlockModalResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalTitle, setModalTitle] = useState('עריכה');
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean> | null>(null);
  const [revealedSecureFields, setRevealedSecureFields] = useState<Record<string, boolean>>({});

  const [vehicleItemOpen, setVehicleItemOpen] = useState(false);
  const [vehicleItemModal, setVehicleItemModal] = useState<VehicleFleetItemModalResponse | null>(null);
  const [vehicleItemDraft, setVehicleItemDraft] = useState<Record<string, unknown>>({});
  const [vehicleItemVis, setVehicleItemVis] = useState<Record<string, boolean> | null>(null);
  const [vehicleItemError, setVehicleItemError] = useState('');

  const [emAddFieldOpen, setEmAddFieldOpen] = useState(false);
  const [emAddLabel, setEmAddLabel] = useState('');
  const [emAddFieldType, setEmAddFieldType] = useState<string>('');
  /** How many list/checkbox items (1..max from server). */
  const [emAddOptionRowCount, setEmAddOptionRowCount] = useState(1);
  /** Fixed length = server max; only first emAddOptionRowCount are submitted. */
  const [emAddOptionRows, setEmAddOptionRows] = useState<string[]>(() => emptyEmOptionRows(EM_ADD_OPTIONS_MAX_FALLBACK));
  const [emAddSaving, setEmAddSaving] = useState(false);
  /** Shown inside “הוספת שדה” only — parent modal errors stay under this overlay and were invisible. */
  const [emAddFieldError, setEmAddFieldError] = useState('');

  const [vehiclesYesNoBusy, setVehiclesYesNoBusy] = useState(false);

  /** Modal payloads loaded on demand (עריכה); cache avoids refetch for same block version. */
  const modalCacheRef = useRef<Partial<Record<BlockKey, AccountingBlockModalResponse>>>({});
  const modalInflightRef = useRef<Partial<Record<BlockKey, Promise<AccountingBlockModalResponse>>>>({});
  /** מסך הוספת רכב — טופס מלא כשגרסת כרטיס רכבים תואמת (ללא המתנה ל-HTTP בפתיחה). */
  const vehicleFleetAddModalCacheRef = useRef<{ version: number; payload: VehicleFleetItemModalResponse } | null>(null);
  /** עריכת רכב לפי vehicle_id — מול אותה גרסת vehicles_version כמו בכרטיס. */
  const vehicleFleetEditModalCacheRef = useRef<Map<string, { version: number; payload: VehicleFleetItemModalResponse }>>(
    new Map()
  );
  const vehiclesYesNoInFlightRef = useRef(false);
  const vehicleDeleteInFlightRef = useRef(false);
  const [vehicleDeleteBusy, setVehicleDeleteBusy] = useState(false);
  const [vehicleFileUploadKey, setVehicleFileUploadKey] = useState<string | null>(null);

  const loadBlockModal = useCallback(
    async (blockKey: BlockKey): Promise<AccountingBlockModalResponse> => {
      const inflight = modalInflightRef.current[blockKey];
      if (inflight) return inflight;

      const p = apiJson<AccountingBlockModalResponse>(
        moduleClientOperationsAccountingSettingsBlockModal(clientId, blockKey)
      )
        .then((out) => {
          modalCacheRef.current[blockKey] = out;
          return out;
        })
        .finally(() => {
          delete modalInflightRef.current[blockKey];
        });

      modalInflightRef.current[blockKey] = p;
      return p;
    },
    [clientId]
  );

  /** Edit-layer schema for the vehicle modal only. Card/list truth stays `accounting_settings_tab` from the client case aggregate. */
  const fetchVehicleItemModal = useCallback(
    (vehicleId: string | null) =>
      apiJson<VehicleFleetItemModalResponse>(
        moduleClientOperationsVehicleFleetItemModal(clientId, vehicleId ?? undefined)
      ),
    [clientId]
  );

  const openVehicleItemModal = async (vehicleId: string | null) => {
    setError('');
    setVehicleItemError('');
    if (vehicleId != null) {
      const vb = tab?.blocks?.find((b) => b.block_key === 'vehicles');
      const v = vb != null ? Number(vb.version) : NaN;
      const hit = vehicleFleetEditModalCacheRef.current.get(vehicleId);
      if (vb && Number.isFinite(v) && hit?.version === v) {
        const m = { ...hit.payload, parent_vehicles_version: v };
        setVehicleItemModal(m);
        setVehicleItemDraft(draftFromVehicleModalFields(m.fields));
        setVehicleItemVis(m.field_visibility);
        setVehicleItemOpen(true);
        return;
      }
    }
    if (vehicleId == null) {
      const vb = tab?.blocks?.find((b) => b.block_key === 'vehicles');
      const v = vb != null ? Number(vb.version) : NaN;
      const hit = vehicleFleetAddModalCacheRef.current;
      if (vb && Number.isFinite(v) && hit?.version === v) {
        const m = hit.payload;
        setVehicleItemModal(m);
        setVehicleItemDraft(draftFromVehicleModalFields(m.fields));
        setVehicleItemVis(m.field_visibility);
        setVehicleItemOpen(true);
        return;
      }
    }
    try {
      const m = await fetchVehicleItemModal(vehicleId);
      setVehicleItemModal(m);
      setVehicleItemDraft(draftFromVehicleModalFields(m.fields));
      setVehicleItemVis(m.field_visibility);
      setVehicleItemOpen(true);
      if (vehicleId == null) {
        const vb = tab?.blocks?.find((b) => b.block_key === 'vehicles');
        const v = vb != null ? Number(vb.version) : NaN;
        if (vb && Number.isFinite(v)) {
          vehicleFleetAddModalCacheRef.current = {
            version: v,
            payload: { ...m, parent_vehicles_version: v },
          };
        }
      } else {
        const vb = tab?.blocks?.find((b) => b.block_key === 'vehicles');
        const v = vb != null ? Number(vb.version) : NaN;
        if (vb && Number.isFinite(v)) {
          vehicleFleetEditModalCacheRef.current.set(vehicleId, {
            version: v,
            payload: { ...m, parent_vehicles_version: v },
          });
        }
      }
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  };

  const refreshVehicleItemVisibility = async (draft: Record<string, unknown>) => {
    try {
      const out = await apiJson<{ field_visibility: Record<string, boolean> }>(
        moduleClientOperationsVehicleFleetItemModalVisibility(clientId),
        { method: 'POST', body: JSON.stringify(draft) }
      );
      setVehicleItemVis(out.field_visibility);
    } catch {
      /* keep previous */
    }
  };

  const patchVehicleItemDraft = (patch: Record<string, unknown>) => {
    setVehicleItemDraft((d) => {
      const merged = { ...d, ...patch };
      void refreshVehicleItemVisibility(merged);
      return merged;
    });
  };

  const saveVehicleItem = async () => {
    if (!vehicleItemModal) return;
    const snapModal = vehicleItemModal;
    const snapDraft = { ...vehicleItemDraft };
    const body = { ...snapDraft, expected_vehicles_version: snapModal.parent_vehicles_version };
    setVehicleItemError('');
    setVehicleItemOpen(false);
    setVehicleItemModal(null);
    delete modalCacheRef.current.vehicles;
    vehicleFleetAddModalCacheRef.current = null;
    vehicleFleetEditModalCacheRef.current.clear();
    try {
      const fullCase = snapModal.vehicle_id
        ? await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
            method: 'POST',
            body: JSON.stringify({
              type: 'update_vehicle_fleet_item',
              payload: { vehicle_id: snapModal.vehicle_id, ...body },
            }),
          })
        : await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
            method: 'POST',
            body: JSON.stringify({
              type: 'create_vehicle_fleet_item',
              payload: body,
            }),
          });
      setTab(fullCase.accounting_settings_tab ?? null);
      onAccountingCaseUpdated(fullCase);
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  };

  const requestDeleteVehicleItem = async (vehicleId: string, plateRaw: string) => {
    const block = tab?.blocks?.find((x) => x.block_key === 'vehicles');
    if (!block || !tab) return;
    if (vehicleDeleteInFlightRef.current) return;
    const plateForMsg = plateRaw && plateRaw !== '—' ? plateRaw : 'ללא מספר רישוי';
    if (
      !window.confirm(
        `האם למחוק את הרכב עם מספר רישוי "${plateForMsg}"?\nפעולה זו אינה הפיכה.`
      )
    ) {
      return;
    }
    const editingSnap = vehicleItemModal;
    const snapVersion = block.version;
    vehicleDeleteInFlightRef.current = true;
    setVehicleDeleteBusy(true);
    setError('');
    vehicleFleetEditModalCacheRef.current.delete(vehicleId);
    if (editingSnap?.vehicle_id === vehicleId) {
      setVehicleItemOpen(false);
      setVehicleItemModal(null);
    }
    try {
      const fullCase = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type: 'delete_vehicle_fleet_item',
          payload: { vehicle_id: vehicleId, expected_vehicles_version: snapVersion },
        }),
      });
      setTab(fullCase.accounting_settings_tab ?? null);
      onAccountingCaseUpdated(fullCase);
      delete modalCacheRef.current.vehicles;
      vehicleFleetAddModalCacheRef.current = null;
      vehicleFleetEditModalCacheRef.current.clear();
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      vehicleDeleteInFlightRef.current = false;
      setVehicleDeleteBusy(false);
    }
  };

  const patchHasVehicles = async (has: boolean) => {
    if (vehiclesYesNoInFlightRef.current) return;
    const block = tab?.blocks?.find((x) => x.block_key === 'vehicles');
    if (!block) return;
    vehiclesYesNoInFlightRef.current = true;
    setVehiclesYesNoBusy(true);
    setError('');
    if (!has) {
      setVehicleItemOpen(false);
      setVehicleItemModal(null);
    }
    try {
      if (has) {
        setVehicleItemError('');
        const applyHasYesResult = (
          out: AccountingTabResponse,
          mr:
            | { ok: true; m: Awaited<ReturnType<typeof fetchVehicleItemModal>> }
            | { ok: false; err: string }
        ) => {
          const vehBlock = out.blocks?.find((x) => x.block_key === 'vehicles');
          const nextVersion =
            vehBlock != null && Number.isFinite(Number(vehBlock.version)) ? Number(vehBlock.version) : undefined;
          setTab(out);
          delete modalCacheRef.current.vehicles;
          if (!mr.ok) {
            setVehicleItemModal(null);
            setVehicleItemVis(null);
            setVehicleItemDraft({});
            setVehicleItemError(mr.err);
            setVehicleItemOpen(true);
          } else {
            const mSynced = nextVersion !== undefined ? { ...mr.m, parent_vehicles_version: nextVersion } : mr.m;
            setVehicleItemModal(mSynced);
            setVehicleItemDraft(draftFromVehicleModalFields(mSynced.fields));
            setVehicleItemVis(mSynced.field_visibility);
            setVehicleItemOpen(true);
            if (nextVersion !== undefined) {
              vehicleFleetAddModalCacheRef.current = { version: nextVersion, payload: mSynced };
            }
          }
        };

        const modalReq = fetchVehicleItemModal(null).then((m) => ({ ok: true as const, m })).catch((e) => ({
          ok: false as const,
          err: userFacingApiMessage(e),
        }));

        const [pr, mr] = await Promise.all([
          apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
            method: 'POST',
            body: JSON.stringify({
              type: 'save_accounting_vehicles_block',
              payload: { expected_version: block.version, has_vehicles: true },
            }),
          }).then((c) => ({ ok: true as const, c })).catch((e) => ({ ok: false as const, err: userFacingApiMessage(e) })),
          modalReq,
        ]);
        if (!pr.ok) {
          setError(pr.err);
        } else {
          const fullCase = pr.c;
          const out = fullCase.accounting_settings_tab;
          if (out) applyHasYesResult(out, mr);
          onAccountingCaseUpdated(fullCase);
        }
      } else {
        const fullCase = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
          method: 'POST',
          body: JSON.stringify({
            type: 'save_accounting_vehicles_block',
            payload: { expected_version: block.version, has_vehicles: false },
          }),
        });
        setTab(fullCase.accounting_settings_tab ?? null);
        onAccountingCaseUpdated(fullCase);
        delete modalCacheRef.current.vehicles;
      }
    } catch (e) {
      setError(userFacingApiMessage(e));
      if (has) {
        setVehicleItemOpen(false);
        setVehicleItemModal(null);
      }
    } finally {
      vehiclesYesNoInFlightRef.current = false;
      setVehiclesYesNoBusy(false);
    }
  };

  useEffect(() => {
    modalCacheRef.current = {};
    modalInflightRef.current = {};
    vehicleFleetAddModalCacheRef.current = null;
    vehicleFleetEditModalCacheRef.current.clear();
  }, [clientId]);

  useEffect(() => {
    setTab(initialAccountingTab ?? null);
    setLoading(false);
    setError('');
  }, [clientId, initialAccountingTab]);

  /** `documents` מוסתר בכוונה — יוצג במקום אחר; לא לשנות אגרגט */
  const blockOrder: BlockKey[] = ['income', 'expense_management', 'expenses', 'vehicles'];
  const blocks = useMemo(() => {
    const by = new Map((tab?.blocks ?? []).map((b) => [b.block_key, b]));
    return blockOrder.map((k) => by.get(k)).filter(Boolean) as AccountingBlockCard[];
  }, [tab]);

  const openModal = async (block: AccountingBlockCard) => {
    setError('');
    setModalError('');
    setModalTitle(`עריכת ${block.block_label}`);
    setModalOpen(true);
    setRevealedSecureFields({});

    const cached = modalCacheRef.current[block.block_key];
    if (cached && cached.version === block.version) {
      setModal(cached);
      setDraft(buildDraftFromModal(cached));
      setFieldVisibility(visibilityFromModal(cached));
      setModalLoading(false);
      return;
    }

    setModalLoading(true);
    setModal(null);
    try {
      const out = await loadBlockModal(block.block_key);
      setModal(out);
      setDraft(buildDraftFromModal(out));
      setFieldVisibility(visibilityFromModal(out));
    } catch (e) {
      setModalError(userFacingApiMessage(e));
    } finally {
      setModalLoading(false);
    }
  };

  const saveModal = async () => {
    if (!modal) return;
    setModalSaving(true);
    setModalError('');
    try {
      const payload = { expected_version: modal.version, ...draft };
      const commandType =
        modal.block_key === 'income'
          ? 'save_accounting_income_block'
          : modal.block_key === 'expense_management'
            ? 'save_accounting_expense_management_block'
            : modal.block_key === 'expenses'
              ? 'save_accounting_fixed_expenses_block'
              : 'save_accounting_vehicles_block';
      const fullCase = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsAccountingCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type: commandType,
          payload,
        }),
      });
      setTab(fullCase.accounting_settings_tab ?? null);
      delete modalCacheRef.current[modal.block_key];
      onAccountingCaseUpdated(fullCase);
      setModalOpen(false);
      setModal(null);
      setFieldVisibility(null);
    } catch (e) {
      setModalError(userFacingApiMessage(e));
    } finally {
      setModalSaving(false);
    }
  };

  const deleteEmCustomField = async (fieldKey: string) => {
    const id = fieldKey.replace(/^em_cf_/, '');
    if (!id) return;
    if (!window.confirm('למחוק את השדה?')) return;
    setModalError('');
    try {
      const fullCase = await apiJson<ClientOperationsCaseResponse>(
        moduleClientOperationsAccountingCommands(clientId),
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'remove_expense_management_custom_field',
            payload: { field_id: id },
          }),
        }
      );
      setTab(fullCase.accounting_settings_tab ?? null);
      onAccountingCaseUpdated(fullCase);
      delete modalCacheRef.current.expense_management;
      const refreshed = await loadBlockModal('expense_management');
      setModal(refreshed);
      setDraft(buildDraftFromModal(refreshed));
      setFieldVisibility(visibilityFromModal(refreshed));
    } catch (e) {
      setModalError(userFacingApiMessage(e));
    }
  };

  const submitEmAddField = async () => {
    setEmAddSaving(true);
    setEmAddFieldError('');
    try {
      const meta = modal?.expense_management_modal_meta;
      const reqTypes = meta?.custom_field_types_requiring_options ?? [...EM_ADD_FIELD_TYPES_NEED_OPTIONS];
      const needsOptions =
        expenseMgmtAddFieldNeedsOptions(emAddFieldType) ||
        (emAddFieldType ? reqTypes.includes(emAddFieldType) : false);
      const optCap = meta?.custom_field_options_max_count ?? EM_ADD_OPTIONS_MAX_FALLBACK;
      let options_lines: string | undefined;
      if (needsOptions) {
        const n = Math.min(Math.max(1, emAddOptionRowCount), optCap);
        const parts = emAddOptionRows.slice(0, n).map((s) => String(s).trim());
        if (parts.length !== n || parts.some((p) => !p)) {
          setEmAddFieldError('נא למלא שם לכל האפשרויות (שורות) שבחרת.');
          setEmAddSaving(false);
          return;
        }
        options_lines = parts.join('\n');
      }
      const fullCase = await apiJson<ClientOperationsCaseResponse>(
        moduleClientOperationsAccountingCommands(clientId),
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'add_expense_management_custom_field',
            payload: {
              label_he: emAddLabel.trim(),
              field_type: emAddFieldType,
              ...(needsOptions && options_lines != null ? { options_lines } : {}),
            },
          }),
        }
      );
      setTab(fullCase.accounting_settings_tab ?? null);
      onAccountingCaseUpdated(fullCase);
      delete modalCacheRef.current.expense_management;
      const refreshed = await loadBlockModal('expense_management');
      setModal(refreshed);
      setDraft(buildDraftFromModal(refreshed));
      setFieldVisibility(visibilityFromModal(refreshed));
      setEmAddFieldOpen(false);
      setEmAddLabel('');
      setEmAddFieldType('');
      const capNext = refreshed.expense_management_modal_meta?.custom_field_options_max_count ?? EM_ADD_OPTIONS_MAX_FALLBACK;
      setEmAddOptionRowCount(1);
      setEmAddOptionRows(emptyEmOptionRows(capNext));
    } catch (e) {
      setEmAddFieldError(userFacingApiMessage(e));
    } finally {
      setEmAddSaving(false);
    }
  };

  const renderExpenseManagementModalField = (f: FieldSchema): ReactNode => {
    if (!modal) return null;
    const disabled = !f.editable || !modal.can_edit || modalSaving;

    if (f.type === 'text' || f.type === 'secure_text') {
      const isSecure = f.type === 'secure_text';
      const secureRevealed = Boolean(revealedSecureFields[f.key]);
      return (
        <div className="client-field">
          <div className="client-field-label">{f.label}</div>
          <div className="client-field-box">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isSecure ? '1fr auto auto' : '1fr',
                gap: 8,
                width: '100%',
                alignItems: 'center',
              }}
            >
              <input
                type={isSecure ? (secureRevealed ? 'text' : 'password') : 'text'}
                value={(draft[f.key] as string | null | undefined) ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                disabled={disabled}
                placeholder={f.placeholder}
                maxLength={f.max_length}
                style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
              />
              {isSecure ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  onClick={() => setRevealedSecureFields((s) => ({ ...s, [f.key]: !secureRevealed }))}
                  disabled={disabled}
                  title={secureRevealed ? 'הסתר סיסמה' : 'הצג סיסמה'}
                  aria-label={secureRevealed ? 'הסתר סיסמה' : 'הצג סיסמה'}
                  style={{ minWidth: 36, paddingInline: 10 }}
                >
                  {secureRevealed ? '🙈' : '👁'}
                </button>
              ) : null}
              {isSecure ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                  onClick={async () => {
                    const value = (draft[f.key] as string | null | undefined) ?? '';
                    if (!value) return;
                    try {
                      await navigator.clipboard.writeText(value);
                    } catch {
                      /* silent */
                    }
                  }}
                  disabled={disabled || !((draft[f.key] as string | null | undefined) ?? '')}
                  title="העתק סיסמה"
                  aria-label="העתק סיסמה"
                  style={{ minWidth: 44, paddingInline: 10 }}
                >
                  העתק
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }

    if (f.type === 'textarea') {
      return (
        <div className="client-field client-field-full">
          <div className="client-field-label">{f.label}</div>
          <textarea
            value={(draft[f.key] as string | null | undefined) ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            disabled={disabled}
            maxLength={f.max_length}
            rows={4}
            style={{ width: '100%', border: '1px solid #dbe3ee', borderRadius: 10, padding: 10 }}
          />
        </div>
      );
    }

    if (f.type === 'enum_single') {
      return (
        <div className="client-field">
          <div className="client-field-label">{f.label}</div>
          <div className="client-field-box">
            <select
              value={(draft[f.key] as string | null | undefined) ?? ''}
              onChange={(e) => {
                const next = e.target.value ? e.target.value : null;
                setDraft((d) => {
                  const merged = { ...d, [f.key]: next };
                  if (f.key === 'expense_delivery_method') {
                    void (async () => {
                      try {
                        const out = await apiJson<{ field_visibility: Record<string, boolean> }>(
                          moduleClientOperationsAccountingSettingsModalVisibility(clientId, 'expense_management'),
                          { method: 'POST', body: JSON.stringify(merged) }
                        );
                        setFieldVisibility(out.field_visibility);
                      } catch {
                        /* keep map */
                      }
                    })();
                  }
                  return merged;
                });
              }}
              disabled={disabled}
              style={{
                border: 'none',
                background: 'transparent',
                width: '100%',
                outline: 'none',
                font: 'inherit',
                appearance: 'none',
              }}
            >
              <option value="">בחר</option>
              {(f.options ?? []).map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    if (f.type === 'enum_multi') {
      const raw = draft[f.key];
      const selected = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
      return (
        <div className="client-field client-field-full">
          <div className="client-field-label">{f.label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {(f.options ?? []).map((o) => {
              const checked = selected.includes(String(o.value));
              return (
                <label key={String(o.value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(String(o.value));
                      else next.delete(String(o.value));
                      setDraft((d) => ({ ...d, [f.key]: Array.from(next) }));
                    }}
                  />
                  <span>{o.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      );
    }

    if (f.type === 'boolean') {
      const raw = draft[f.key];
      let sel = '';
      if (raw === true || raw === 'true') sel = 'true';
      else if (raw === false || raw === 'false') sel = 'false';
      return (
        <div className="client-field">
          <div className="client-field-label">{f.label}</div>
          <div className="client-field-box">
            <select
              value={sel}
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => ({
                  ...d,
                  [f.key]: v === '' ? null : v === 'true',
                }));
              }}
              disabled={disabled}
              style={{
                border: 'none',
                background: 'transparent',
                width: '100%',
                outline: 'none',
                font: 'inherit',
                appearance: 'none',
              }}
            >
              <option value="">בחר</option>
              <option value="true">כן</option>
              <option value="false">לא</option>
            </select>
          </div>
        </div>
      );
    }

    return null;
  };

  if (loading) return <div className="nx-accounting-section-root">טוען…</div>;
  if (!tab && initialAccountingTab === null) {
    return (
      <div className="nx-accounting-section-root" style={{ color: '#6b7280', fontWeight: 600 }}>
        אין הרשאה לצפות בהגדרות הנה״ח (כרטיסיות).
      </div>
    );
  }

  return (
    <div className="nx-accounting-section-root">
      {error ? (
        <div
          className="nx-accounting-tab-error-banner"
          role="alert"
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ flex: '1 1 12rem' }}>{error}</span>
          <button
            type="button"
            className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
            onClick={() => setError('')}
          >
            סגירה
          </button>
        </div>
      ) : null}
      <div className="nx-accounting-cards-grid">
        {blocks.map((b) => (
          <div key={b.block_key} className="nx-accounting-card">
            {b.block_key === 'income' ||
            b.block_key === 'expenses' ||
            b.block_key === 'expense_management' ||
            b.block_key === 'vehicles' ? (
              <h3 className="nx-accounting-section-title" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
                {b.block_label}
              </h3>
            ) : (
              <div className="nx-accounting-card-title">{b.block_label}</div>
            )}
            {b.block_key === 'expense_management' && b.expense_management_zones ? (
              <ExpenseManagementZonesPanel zones={b.expense_management_zones} />
            ) : b.excel_grid && b.block_key !== 'vehicles' ? (
              <div className="nx-income-excel">
                <div className="nx-income-excel-header-row">
                  <div className="nx-income-excel-header-cell">{b.excel_grid.column_headers[0]}</div>
                  <div className="nx-income-excel-header-cell">{b.excel_grid.column_headers[1]}</div>
                </div>
                <div className="nx-income-excel-body">
                  <div className="nx-income-table nx-income-table-stretch">
                    {b.excel_grid.rows.map((r, idx) => (
                      <div key={`em-l-${idx}`} className="nx-income-table-row nx-income-table-row-split">
                        <span>{r.left?.visible ? r.left.label : 'לא הוגדר'}</span>
                        <ExcelGridCellValue cell={r.left} />
                      </div>
                    ))}
                  </div>
                  <div className="nx-income-table nx-income-table-stretch">
                    {b.excel_grid.rows.map((r, idx) => (
                      <div key={`em-r-${idx}`} className="nx-income-table-row nx-income-table-row-split">
                        <span>{r.right?.visible ? r.right.label : 'לא הוגדר'}</span>
                        <ExcelGridCellValue cell={r.right} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : b.block_key === 'income' ? (
              <div className="nx-em-two-col">
                <div className="nx-em-col nx-em-col-access" dir="rtl">
                  <div className="nx-income-table">
                    <div className="nx-fe-fixed-exp-colhead">מערכת הכנסות</div>
                    {(b.summary_items ?? []).map((it, idx) => (
                      <div key={`income-right-${idx}`} className="nx-income-table-row nx-income-table-row-split">
                        <span>{it.label}</span>
                        <AccountingSummaryItemValue it={it} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="nx-em-col nx-em-col-ops" dir="rtl">
                  <div className="nx-income-table">
                    <div className="nx-fe-fixed-exp-colhead">הכנסות נוספות</div>
                    {(b.summary_primary_rows ?? []).length > 0
                      ? (b.summary_primary_rows ?? []).map((row, idx) => (
                          <div key={`income-left-${idx}`} className="nx-income-table-row">
                            <span>{row}</span>
                          </div>
                        ))
                      : (
                          <div className="nx-income-table-row">
                            <span>{b.summary_empty_state_text}</span>
                          </div>
                        )}
                  </div>
                </div>
              </div>
            ) : b.block_key === 'expenses' ? (
              <div className="nx-em-two-col">
                <div className="nx-em-col nx-em-col-access" dir="rtl">
                  <div className="nx-income-table">
                    <div className="nx-fe-fixed-exp-colhead">סכומים חודשיים</div>
                    {(b.summary_primary_rows ?? []).length > 0
                      ? (b.summary_primary_rows ?? []).map((row, idx) => (
                          <div key={`exp-amt-${idx}`} className="nx-income-table-row">
                            <span>{row}</span>
                          </div>
                        ))
                      : (
                          <div className="nx-income-table-row">
                            <span>{b.summary_empty_state_text}</span>
                          </div>
                        )}
                  </div>
                </div>
                <div className="nx-em-col nx-em-col-ops" dir="rtl">
                  <div className="nx-income-table">
                    <div className="nx-fe-fixed-exp-colhead">אחוז הוצאה מוכר</div>
                    {b.summary_secondary_empty_message != null ? (
                      <div className="nx-income-table-row">
                        <span>{b.summary_secondary_empty_message}</span>
                      </div>
                    ) : (
                      (b.summary_items ?? []).map((it, idx) => (
                        <div key={`exp-pct-${idx}`} className="nx-income-table-row nx-income-table-row-split">
                          <span>{it.label}</span>
                          <span>{it.value || '—'}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : b.block_key === 'vehicles' ? (
              <>
                {(() => {
                  const vehiclesFleetRows =
                    b.has_vehicles &&
                    b.excel_grid &&
                    (b.vehicle_items?.length ?? 0) > 0 &&
                    (b.excel_grid.rows?.length ?? 0) > 0;
                  const vehiclesEmptyFleetShell =
                    b.has_vehicles &&
                    b.excel_grid &&
                    (b.vehicle_items?.length ?? 0) === 0;
                  const vehiclesSummaryText = b.summary_text || '';
                  return (
                    <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
                  {b.vehicles_yes_no ? (
                    <div role="radiogroup" aria-label={b.vehicles_yes_no.label}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{b.vehicles_yes_no.label}</div>
                      {(() => {
                        const yesNoVal = b.vehicles_yes_no!.value;
                        const disabled = !b.can_edit || vehiclesYesNoBusy;
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
                            {b.vehicles_yes_no!.options.map((o) => (
                              <label
                                key={o.value}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  cursor: disabled ? 'default' : 'pointer',
                                  opacity: vehiclesYesNoBusy ? 0.75 : 1,
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`vehicles-yesno-${b.version}`}
                                  value={o.value}
                                  checked={yesNoVal === o.value}
                                  disabled={disabled}
                                  onChange={() => {
                                    if (disabled) return;
                                    if (yesNoVal === o.value) return;
                                    if (o.value === 'yes') void patchHasVehicles(true);
                                    else void patchHasVehicles(false);
                                  }}
                                />
                                <span>{o.label}</span>
                              </label>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                  {b.can_edit ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(b.vehicle_block_actions ?? [])
                        .filter((a) => a.enabled && a.action_key === 'add_vehicle')
                        .map((a) => (
                          <button
                            key={a.action_key}
                            type="button"
                            className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                            onClick={() => void openVehicleItemModal(null)}
                          >
                            {a.label}
                          </button>
                        ))}
                    </div>
                  ) : null}
                </div>

                {vehiclesSummaryText ? (
                  <div className="nx-accounting-card-summary" style={{ marginBottom: 8 }}>
                    {vehiclesSummaryText}
                  </div>
                ) : null}

                {vehiclesFleetRows
                  ? (b.vehicle_items ?? []).map((it, vIdx) => {
                      const secRows = b.excel_grid!.rows.slice(vIdx * 2, vIdx * 2 + 2);
                      if (secRows.length === 0) return null;
                      const r0 = secRows[0];
                      const plateRaw = r0?.left?.visible ? String(r0.left.value ?? '').trim() : '';
                      const sectionTitle =
                        plateRaw && plateRaw !== '—' ? `רכב — ${plateRaw}` : `רכב ${vIdx + 1}`;
                      return (
                        <div key={it.vehicle_id} className="nx-vehicle-fleet-section">
                          <div className="nx-vehicle-fleet-section-head">
                            <span className="nx-vehicle-fleet-section-title">{sectionTitle}</span>
                            {it.edit_action?.enabled ? (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                  alignItems: 'center',
                                }}
                              >
                                <button
                                  type="button"
                                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                  onClick={() => void openVehicleItemModal(it.vehicle_id)}
                                >
                                  {it.edit_action.label}
                                </button>
                                <button
                                  type="button"
                                  className="nx-btn nx-btn-danger-ghost nx-btn-taxes-compact"
                                  disabled={vehicleDeleteBusy}
                                  onClick={() => void requestDeleteVehicleItem(it.vehicle_id, plateRaw)}
                                >
                                  למחוק
                                </button>
                              </div>
                            ) : null}
                          </div>
                          {/* אותה פריסת שני טורים כמו הכנסות / הוצאות קבועות — nx-em-two-col + מרווחים */}
                          <div className="nx-em-two-col" style={{ marginTop: 0 }}>
                            <div className="nx-em-col nx-em-col-access" dir="rtl">
                              <div className="nx-income-table">
                                <div className="nx-fe-fixed-exp-colhead">{b.excel_grid!.column_headers[0]}</div>
                                {secRows.map((r, rowIdx) => (
                                  <div
                                    key={`veh-${it.vehicle_id}-l-${rowIdx}`}
                                    className="nx-income-table-row nx-income-table-row-split"
                                  >
                                    <span>{r.left?.visible ? r.left.label : 'לא הוגדר'}</span>
                                    <ExcelGridCellValue cell={r.left} />
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="nx-em-col nx-em-col-ops" dir="rtl">
                              <div className="nx-income-table">
                                <div className="nx-fe-fixed-exp-colhead">{b.excel_grid!.column_headers[1]}</div>
                                {secRows.map((r, rowIdx) => (
                                  <div
                                    key={`veh-${it.vehicle_id}-r-${rowIdx}`}
                                    className="nx-income-table-row nx-income-table-row-split"
                                  >
                                    <span>{r.right?.visible ? r.right.label : 'לא הוגדר'}</span>
                                    <ExcelGridCellValue cell={r.right} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  : vehiclesEmptyFleetShell && b.excel_grid ? (
                      <div className="nx-em-two-col" style={{ marginTop: 8 }}>
                        <div className="nx-em-col nx-em-col-access" dir="rtl">
                          <div className="nx-income-table">
                            <div className="nx-fe-fixed-exp-colhead">{b.excel_grid.column_headers[0]}</div>
                            <div className="nx-income-table-row nx-income-table-row-split">
                              <span>רשימת רכבים</span>
                              <span style={{ color: '#6b7280' }}>אין רכבים — השתמשו ב״הוסף רכב״</span>
                            </div>
                          </div>
                        </div>
                        <div className="nx-em-col nx-em-col-ops" dir="rtl">
                          <div className="nx-income-table">
                            <div className="nx-fe-fixed-exp-colhead">{b.excel_grid.column_headers[1]}</div>
                            <div className="nx-income-table-row nx-income-table-row-split">
                              <span>—</span>
                              <span>—</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    </>
                  );
                })()}
              </>
            ) : (
              <>
                <div className="nx-accounting-card-summary">{b.summary_text}</div>
                {b.summary_items?.length ? (
                  <div className="nx-accounting-card-items">
                    {(b.summary_items ?? []).map((it, idx) => (
                      <div key={`${b.block_key}-${idx}`} className="nx-accounting-card-item">
                        <span>{it.label}</span>
                        {it.value ? <span>{it.value}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            {b.block_key !== 'vehicles' && b.can_edit ? (
              <button
                type="button"
                className="nx-taxes-section-edit-btn"
                onClick={() => void openModal(b)}
                aria-label={`עריכת ${b.block_label}`}
                title={`עריכת ${b.block_label}`}
                style={{ marginTop: 8 }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {modalOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div
            className="nx-modal nx-accounting-editor-modal"
            style={{
              maxWidth: modal?.block_key === 'expense_management' ? 880 : 760,
              direction: 'rtl',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">{modal?.modal_label ?? modalTitle}</h3>
            </div>
            <div className="nx-modal-body">
              {modalLoading ? (
                <div style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontWeight: 700 }}>
                  טוען…
                </div>
              ) : modal ? (
                modal.block_key === 'expense_management' ? (
                  <div className="nx-em-modal-2col-wrap">
                    {(() => {
                      const visMerged = { ...visibilityFromModal(modal), ...(fieldVisibility ?? {}) };
                      const vf = modal.fields.filter((ff) => (visMerged[ff.key] ?? ff.visible) !== false);
                      const leftFs = EXPENSE_MANAGEMENT_MODAL_LEFT_KEYS.map((k) => vf.find((x) => x.key === k)).filter(
                        (x): x is FieldSchema => Boolean(x)
                      );
                      const coreRight = EXPENSE_MANAGEMENT_MODAL_RIGHT_KEYS.map((k) => vf.find((x) => x.key === k)).filter(
                        (x): x is FieldSchema => Boolean(x)
                      );
                      const customEm = vf.filter((f) => f.key.startsWith('em_cf_'));
                      const meta = modal.expense_management_modal_meta;
                      const canAddCustom = Boolean(
                        modal.can_edit && meta && meta.custom_field_count < meta.custom_field_capacity
                      );
                      return (
                        <div className="nx-em-modal-2col">
                          <div className="nx-em-modal-col nx-em-modal-col-left" dir="rtl">
                            {leftFs.map((ff) => (
                              <Fragment key={ff.key}>{renderExpenseManagementModalField(ff)}</Fragment>
                            ))}
                          </div>
                          <div className="nx-em-modal-col nx-em-modal-col-right" dir="rtl">
                            {coreRight.map((ff) => (
                              <Fragment key={ff.key}>{renderExpenseManagementModalField(ff)}</Fragment>
                            ))}
                            {canAddCustom ? (
                              <div style={{ marginTop: 4 }}>
                                <button
                                  type="button"
                                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                  onClick={() => {
                                    const cap =
                                      modal?.expense_management_modal_meta?.custom_field_options_max_count ??
                                      EM_ADD_OPTIONS_MAX_FALLBACK;
                                    setEmAddLabel('');
                                    setEmAddFieldType('');
                                    setEmAddOptionRowCount(1);
                                    setEmAddOptionRows(emptyEmOptionRows(cap));
                                    setEmAddFieldError('');
                                    setEmAddFieldOpen(true);
                                  }}
                                  disabled={modalSaving}
                                >
                                  + הוספת שדה
                                </button>
                              </div>
                            ) : null}
                            {customEm.map((ff) => (
                              <div key={ff.key}>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                                  {modal.can_edit && !modalSaving ? (
                                    <button
                                      type="button"
                                      className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                      style={{ fontSize: 12, padding: '4px 10px' }}
                                      onClick={() => void deleteEmCustomField(ff.key)}
                                    >
                                      מחיקה
                                    </button>
                                  ) : null}
                                </div>
                                {renderExpenseManagementModalField(ff)}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                <div className="client-profile-grid">
                  {modal.fields
                    .filter((f) => (fieldVisibility ?? visibilityFromModal(modal))[f.key] ?? f.visible)
                    .map((f) => {
                  const disabled = !f.editable || !modal.can_edit || modalSaving;
                  if (f.type === 'text' || f.type === 'secure_text') {
                    const isSecure = f.type === 'secure_text';
                    const secureRevealed = Boolean(revealedSecureFields[f.key]);
                    return (
                      <div className="client-field" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <div className="client-field-box">
                          <div style={{ display: 'grid', gridTemplateColumns: isSecure ? '1fr auto auto' : '1fr', gap: 8, width: '100%', alignItems: 'center' }}>
                            <input
                              type={isSecure ? (secureRevealed ? 'text' : 'password') : 'text'}
                              value={(draft[f.key] as string | null | undefined) ?? ''}
                              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                              disabled={disabled}
                              placeholder={f.placeholder}
                              maxLength={f.max_length}
                              style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                            />
                            {isSecure ? (
                              <button
                                type="button"
                                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                onClick={() =>
                                  setRevealedSecureFields((s) => ({ ...s, [f.key]: !secureRevealed }))
                                }
                                disabled={disabled}
                                title={secureRevealed ? 'הסתר סיסמה' : 'הצג סיסמה'}
                                aria-label={secureRevealed ? 'הסתר סיסמה' : 'הצג סיסמה'}
                                style={{ minWidth: 36, paddingInline: 10 }}
                              >
                                {secureRevealed ? '🙈' : '👁'}
                              </button>
                            ) : null}
                            {isSecure ? (
                              <button
                                type="button"
                                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                onClick={async () => {
                                  const value = (draft[f.key] as string | null | undefined) ?? '';
                                  if (!value) return;
                                  try {
                                    await navigator.clipboard.writeText(value);
                                  } catch {
                                    // silent fallback: keep UX simple in this modal
                                  }
                                }}
                                disabled={disabled || !((draft[f.key] as string | null | undefined) ?? '')}
                                title="העתק סיסמה"
                                aria-label="העתק סיסמה"
                                style={{ minWidth: 44, paddingInline: 10 }}
                              >
                                העתק
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'textarea') {
                    return (
                      <div className="client-field client-field-full" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <textarea
                          value={(draft[f.key] as string | null | undefined) ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          disabled={disabled}
                          maxLength={f.max_length}
                          rows={3}
                          style={{ width: '100%', border: '1px solid #dbe3ee', borderRadius: 10, padding: 10 }}
                        />
                      </div>
                    );
                  }
                  if (f.type === 'enum_single') {
                    return (
                      <div className="client-field" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <div className="client-field-box">
                          <select
                            value={(draft[f.key] as string | null | undefined) ?? ''}
                            onChange={(e) => {
                              const next = e.target.value ? e.target.value : null;
                              setDraft((d) => {
                                const merged = { ...d, [f.key]: next };
                                if (
                                  modal.block_key === 'expense_management' &&
                                  f.key === 'expense_delivery_method'
                                ) {
                                  void (async () => {
                                    try {
                                      const out = await apiJson<{ field_visibility: Record<string, boolean> }>(
                                        moduleClientOperationsAccountingSettingsModalVisibility(
                                          clientId,
                                          'expense_management'
                                        ),
                                        { method: 'POST', body: JSON.stringify(merged) }
                                      );
                                      setFieldVisibility(out.field_visibility);
                                    } catch {
                                      /* keep map */
                                    }
                                  })();
                                }
                                return merged;
                              });
                            }}
                            disabled={disabled}
                            style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit', appearance: 'none' }}
                          >
                            <option value="">בחר</option>
                            {(f.options ?? []).map((o) => (
                              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'boolean') {
                    return (
                      <div className="client-field" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <div className="client-field-box">
                          <select
                            value={Boolean(draft[f.key]) ? 'true' : 'false'}
                            onChange={(e) => {
                              const nextVal = e.target.value === 'true';
                              setDraft((d) => ({ ...d, [f.key]: nextVal }));
                            }}
                            disabled={disabled}
                            style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit', appearance: 'none' }}
                          >
                            {(f.options ?? []).map((o) => (
                              <option key={String(o.value)} value={o.value ? 'true' : 'false'}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'integer' || f.type === 'numeric') {
                    return (
                      <div className="client-field" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <div className="client-field-box">
                          <input
                            type="number"
                            value={(draft[f.key] as number | null | undefined) ?? ''}
                            min={f.min}
                            max={f.max}
                            step={f.type === 'integer' ? 1 : 'any'}
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                            disabled={disabled}
                            style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                          />
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'date') {
                    return (
                      <div className="client-field" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <div className="client-field-box">
                          <input
                            type="date"
                            value={
                              draft[f.key] != null && String(draft[f.key]).length
                                ? String(draft[f.key]).slice(0, 10)
                                : ''
                            }
                            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value || null }))}
                            disabled={disabled}
                            style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                          />
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'enum_multi') {
                    const value = draft[f.key];
                    if (f.key === 'expense_items' && Array.isArray(value)) {
                      return (
                        <div className="client-field client-field-full" key={f.key}>
                          <div className="client-field-label">{f.label}</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {(value as Array<any>).map((it, idx) => {
                              const isAmount = it.value_kind === 'amount';
                              return (
                                <div
                                  key={`${it.expense_type_code}-${idx}`}
                                  style={{ display: 'grid', gridTemplateColumns: '1fr minmax(150px, 220px)', gap: 8, alignItems: 'center' }}
                                >
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(it.selected)}
                                      disabled={disabled}
                                      onChange={(e) => {
                                        void (async () => {
                                          const next = [...(value as Array<any>)];
                                          next[idx] = { ...next[idx], selected: e.target.checked };
                                          try {
                                            const out = await apiJson<{
                                              expense_items: unknown[];
                                              field_visibility?: Record<string, boolean>;
                                            }>(moduleClientOperationsAccountingSettingsBlockNormalizeDraft(clientId, 'expenses'), {
                                              method: 'POST',
                                              body: JSON.stringify({ expense_items: next }),
                                            });
                                            setDraft((d) => ({ ...d, [f.key]: out.expense_items }));
                                            if (out.field_visibility) setFieldVisibility(out.field_visibility);
                                          } catch (err) {
                                            setModalError(err instanceof Error ? err.message : 'שגיאה');
                                          }
                                        })();
                                      }}
                                    />
                                    <span>{it.expense_type_label_he}</span>
                                  </label>
                                  <div className="nx-expense-value-with-suffix" dir="ltr">
                                    {isAmount ? (
                                      <>
                                        <input
                                          type="number"
                                          min={0}
                                          step={0.01}
                                          disabled={disabled || !it.selected}
                                          value={it.monthly_amount_ils ?? ''}
                                          onChange={(e) => {
                                            const next = [...(value as Array<any>)];
                                            const raw = e.target.value;
                                            next[idx] = {
                                              ...next[idx],
                                              monthly_amount_ils: raw === '' ? null : Number(raw),
                                            };
                                            setDraft((d) => ({ ...d, [f.key]: next }));
                                          }}
                                          className="nx-expense-value-input"
                                        />
                                        <span className="nx-expense-suffix" aria-hidden>
                                          ₪
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={1}
                                          disabled={disabled || !it.selected}
                                          value={it.business_percent ?? ''}
                                          onChange={(e) => {
                                            const next = [...(value as Array<any>)];
                                            const raw = e.target.value;
                                            next[idx] = {
                                              ...next[idx],
                                              business_percent: raw === '' ? null : Number(raw),
                                            };
                                            setDraft((d) => ({ ...d, [f.key]: next }));
                                          }}
                                          className="nx-expense-value-input"
                                        />
                                        <span className="nx-expense-suffix" aria-hidden>
                                          %
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    if (f.key === 'income_source_items' && Array.isArray(value)) {
                      return (
                        <div className="client-field client-field-full" key={f.key}>
                          <div className="client-field-label">{f.label}</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {(value as Array<any>).map((it, idx) => (
                              <div key={`${it.source_code}-${idx}`} style={{ display: 'grid', gap: 8 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8, alignItems: 'center' }}>
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(it.selected)}
                                      disabled={disabled}
                                      onChange={(e) => {
                                        void (async () => {
                                          const next = [...(value as Array<any>)];
                                          next[idx] = { ...next[idx], selected: e.target.checked };
                                          try {
                                            const out = await apiJson<{
                                              income_source_items: unknown[];
                                              field_visibility?: Record<string, boolean>;
                                            }>(moduleClientOperationsAccountingSettingsBlockNormalizeDraft(clientId, 'income'), {
                                              method: 'POST',
                                              body: JSON.stringify({ income_source_items: next }),
                                            });
                                            setDraft((d) => ({ ...d, [f.key]: out.income_source_items }));
                                            if (out.field_visibility) setFieldVisibility(out.field_visibility);
                                          } catch (err) {
                                            setModalError(err instanceof Error ? err.message : 'שגיאה');
                                          }
                                        })();
                                      }}
                                    />
                                    <span>{it.source_label_he}</span>
                                    {it.source_code === 'business' && it.selected ? (
                                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                                        {[
                                          Array.isArray(it.additional_business_type_options)
                                            ? (it.additional_business_type_options as Option[]).find(
                                                (o) => String(o.value) === String(it.additional_business_type ?? '')
                                              )?.label ?? null
                                            : null,
                                          it.additional_business_tax_id ? String(it.additional_business_tax_id) : null,
                                        ]
                                          .filter(Boolean)
                                          .join(' / ')}
                                      </span>
                                    ) : null}
                                    {it.source_code === 'salary' && it.selected ? (
                                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                                        {[it.workplace_name ? String(it.workplace_name) : null, it.employment_scope ? String(it.employment_scope) : null]
                                          .filter(Boolean)
                                          .join(' / ')}
                                      </span>
                                    ) : null}
                                    {(it.source_code === 'allowance' || it.source_code === 'other') && it.selected ? (
                                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                                        {it.source_details ? String(it.source_details) : ''}
                                      </span>
                                    ) : null}
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    disabled={disabled || !it.selected}
                                    value={it.monthly_amount ?? ''}
                                    placeholder="סכום"
                                    onChange={(e) => {
                                      const next = [...(value as Array<any>)];
                                      next[idx] = {
                                        ...next[idx],
                                        monthly_amount: e.target.value === '' ? null : Number(e.target.value),
                                      };
                                      setDraft((d) => ({ ...d, [f.key]: next }));
                                    }}
                                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee' }}
                                  />
                                </div>

                                {it.source_code === 'business' && it.selected ? (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <select
                                      disabled={disabled}
                                      value={it.additional_business_type ?? ''}
                                      onChange={(e) => {
                                        const next = [...(value as Array<any>)];
                                        next[idx] = {
                                          ...next[idx],
                                          additional_business_type: e.target.value || null,
                                        };
                                        setDraft((d) => ({ ...d, [f.key]: next }));
                                      }}
                                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee' }}
                                    >
                                      <option value="">בחר סוג עסק נוסף</option>
                                      {Array.isArray(it.additional_business_type_options)
                                        ? it.additional_business_type_options.map((o: any) => (
                                            <option key={String(o.value)} value={String(o.value)}>
                                              {String(o.label)}
                                            </option>
                                          ))
                                        : null}
                                    </select>
                                    <input
                                      type="text"
                                      disabled={disabled}
                                      value={it.additional_business_tax_id ?? ''}
                                      placeholder="ח.פ העסק"
                                      onChange={(e) => {
                                        const next = [...(value as Array<any>)];
                                        next[idx] = {
                                          ...next[idx],
                                          additional_business_tax_id: e.target.value,
                                        };
                                        setDraft((d) => ({ ...d, [f.key]: next }));
                                      }}
                                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee' }}
                                    />
                                  </div>
                                ) : null}

                                {it.source_code === 'salary' && it.selected ? (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <input
                                      type="text"
                                      disabled={disabled}
                                      value={it.workplace_name ?? ''}
                                      placeholder="מקום עבודה"
                                      onChange={(e) => {
                                        const next = [...(value as Array<any>)];
                                        next[idx] = {
                                          ...next[idx],
                                          workplace_name: e.target.value,
                                        };
                                        setDraft((d) => ({ ...d, [f.key]: next }));
                                      }}
                                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee' }}
                                    />
                                    <input
                                      type="text"
                                      disabled={disabled}
                                      value={it.employment_scope ?? ''}
                                      placeholder="היקף המשרה"
                                      onChange={(e) => {
                                        const next = [...(value as Array<any>)];
                                        next[idx] = {
                                          ...next[idx],
                                          employment_scope: e.target.value,
                                        };
                                        setDraft((d) => ({ ...d, [f.key]: next }));
                                      }}
                                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee' }}
                                    />
                                  </div>
                                ) : null}

                                {(it.source_code === 'allowance' || it.source_code === 'other') && it.selected ? (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                                    <input
                                      type="text"
                                      disabled={disabled}
                                      value={it.source_details ?? ''}
                                      placeholder="איזו הכנסה בדיוק"
                                      onChange={(e) => {
                                        const next = [...(value as Array<any>)];
                                        next[idx] = {
                                          ...next[idx],
                                          source_details: e.target.value,
                                        };
                                        setDraft((d) => ({ ...d, [f.key]: next }));
                                      }}
                                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee' }}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    const selected = Array.isArray(value) ? (value as Array<string | number>) : [];
                    return (
                      <div className="client-field client-field-full" key={f.key}>
                        <div className="client-field-label">{f.label}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                          {(f.options ?? []).map((o) => {
                            const checked = selected.map(String).includes(String(o.value));
                            return (
                              <label key={String(o.value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={(e) => {
                                    const next = new Set(selected.map(String));
                                    if (e.target.checked) next.add(String(o.value));
                                    else next.delete(String(o.value));
                                    setDraft((d) => ({ ...d, [f.key]: Array.from(next) }));
                                  }}
                                />
                                <span>{o.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  return null;
                  })}
                </div>
                )
              ) : null}
              {modalError ? <p style={{ color: '#b91c1c', fontWeight: 700 }}>{modalError}</p> : null}
            </div>
            <div className="nx-modal-footer">
              {modal?.can_edit ? (
                <button type="button" className="nx-btn nx-btn-primary" onClick={() => void saveModal()} disabled={modalSaving}>
                  {modalSaving ? 'שומר…' : 'שמירה'}
                </button>
              ) : null}
              <button type="button" className="nx-btn nx-btn-secondary" onClick={() => setModalOpen(false)} disabled={modalSaving}>
                סגירה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {vehicleItemOpen ? (
        <div
          className="nx-modal-overlay"
          style={{ zIndex: 10001 }}
          role="presentation"
          onClick={() => setVehicleItemOpen(false)}
        >
          <div
            className="nx-modal nx-accounting-editor-modal"
            style={{ maxWidth: 720, direction: 'rtl' }}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">{vehicleItemModal?.modal_label ?? 'הוספת רכב'}</h3>
            </div>
            <div className="nx-modal-body" style={{ flex: '0 1 auto' }}>
              {vehicleItemModal ? (
                <div className="client-profile-grid">
                  {(() => {
                    const vis = vehicleItemVis ?? vehicleItemModal.field_visibility;
                    const rows = vehicleItemModal.fields.filter((ff) => vis[ff.key] !== false);
                    let lastGl = '';
                    return rows.map((f) => {
                      const dis = !f.editable || !vehicleItemModal.can_edit;
                      const gl = f.group_label && f.group_label !== lastGl ? f.group_label : null;
                      if (gl) lastGl = f.group_label!;
                      const v = vehicleItemDraft[f.key];
                      const fieldWrap = (inner: ReactNode) => (
                        <Fragment key={f.key}>
                          {gl ? (
                            <div className="client-field client-field-full" style={{ gridColumn: '1 / -1' }}>
                              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>{gl}</div>
                            </div>
                          ) : null}
                          {inner}
                        </Fragment>
                      );
                      if (f.type === 'text' || f.type === 'textarea') {
                        if (f.type === 'textarea') {
                          return fieldWrap(
                            <div className="client-field client-field-full">
                              <div className="client-field-label">{f.label}</div>
                              <textarea
                                value={(v as string | null | undefined) ?? ''}
                                disabled={dis}
                                maxLength={f.max_length}
                                rows={3}
                                onChange={(e) => patchVehicleItemDraft({ [f.key]: e.target.value || null })}
                                style={{ width: '100%', border: '1px solid #dbe3ee', borderRadius: 10, padding: 10 }}
                              />
                            </div>
                          );
                        }
                        return fieldWrap(
                          <div className="client-field">
                            <div className="client-field-label">{f.label}</div>
                            <div className="client-field-box">
                              <input
                                type="text"
                                value={(v as string | null | undefined) ?? ''}
                                disabled={dis}
                                maxLength={f.max_length}
                                placeholder={f.placeholder}
                                onChange={(e) => patchVehicleItemDraft({ [f.key]: e.target.value || null })}
                                style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                              />
                            </div>
                          </div>
                        );
                      }
                      if (f.type === 'enum_single') {
                        if (f.display_as === 'radio') {
                          return fieldWrap(
                            <div className="client-field client-field-full">
                              <div className="client-field-label">{f.label}</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }} role="radiogroup" aria-label={f.label}>
                                {(f.options ?? []).map((o) => (
                                  <label key={String(o.value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <input
                                      type="radio"
                                      name={`vi-${f.key}`}
                                      checked={String(v ?? '') === String(o.value)}
                                      disabled={dis}
                                      onChange={() => patchVehicleItemDraft({ [f.key]: o.value })}
                                    />
                                    <span>{o.label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        return fieldWrap(
                          <div className="client-field">
                            <div className="client-field-label">{f.label}</div>
                            <div className="client-field-box">
                              <select
                                value={(v as string | null | undefined) ?? ''}
                                disabled={dis}
                                onChange={(e) =>
                                  patchVehicleItemDraft({ [f.key]: e.target.value ? e.target.value : null })
                                }
                                style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                              >
                                <option value="">בחר</option>
                                {(f.options ?? []).map((o) => (
                                  <option key={String(o.value)} value={String(o.value)}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      }
                      if (f.type === 'boolean') {
                        return fieldWrap(
                          <div className="client-field">
                            <div className="client-field-label">{f.label}</div>
                            <div className="client-field-box">
                              <select
                                value={Boolean(v) ? 'true' : 'false'}
                                disabled={dis}
                                onChange={(e) => patchVehicleItemDraft({ [f.key]: e.target.value === 'true' })}
                                style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                              >
                                {(f.options ?? []).map((o) => (
                                  <option key={String(o.value)} value={o.value ? 'true' : 'false'}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      }
                      if (f.type === 'integer' || f.type === 'numeric') {
                        return fieldWrap(
                          <div className="client-field">
                            <div className="client-field-label">{f.label}</div>
                            <div className="client-field-box">
                              <input
                                type="number"
                                value={(v as number | null | undefined) ?? ''}
                                min={f.min}
                                max={f.max}
                                step={f.type === 'integer' ? 1 : 'any'}
                                disabled={dis}
                                onChange={(e) =>
                                  patchVehicleItemDraft({
                                    [f.key]: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                                style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                              />
                            </div>
                          </div>
                        );
                      }
                      if (f.type === 'date') {
                        return fieldWrap(
                          <div className="client-field">
                            <div className="client-field-label">{f.label}</div>
                            <div className="client-field-box">
                              <input
                                type="date"
                                value={v != null && String(v).length ? String(v).slice(0, 10) : ''}
                                disabled={dis}
                                onChange={(e) => patchVehicleItemDraft({ [f.key]: e.target.value || null })}
                                style={{ border: 'none', background: 'transparent', width: '100%', outline: 'none', font: 'inherit' }}
                              />
                            </div>
                          </div>
                        );
                      }
                      if (f.type === 'vehicle_file') {
                        const nameKey = vehicleFileDisplayNameKey(f.key);
                        const assetId =
                          v != null && String(v).trim() !== '' ? String(v) : null;
                        const displayName =
                          (vehicleItemDraft[nameKey] as string | null | undefined) ?? null;
                        return fieldWrap(
                          <div className="client-field client-field-full">
                            <div className="client-field-label">{f.label}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontSize: 13 }}>{displayName || '—'}</span>
                              {assetId && !dis ? (
                                <button
                                  type="button"
                                  className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                  onClick={async () => {
                                    setVehicleItemError('');
                                    try {
                                      const { url } = await apiJson<{ url: string }>(
                                        moduleClientOperationsAccountingVehicleFleetFileOpen(clientId, assetId)
                                      );
                                      window.open(url, '_blank', 'noopener,noreferrer');
                                    } catch (err) {
                                      setVehicleItemError(userFacingApiMessage(err));
                                    }
                                  }}
                                >
                                  פתיחה
                                </button>
                              ) : null}
                              {!dis ? (
                                <>
                                  <input
                                    type="file"
                                    id={`vf-file-${f.key}`}
                                    style={{ display: 'none' }}
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!file) return;
                                      setVehicleFileUploadKey(f.key);
                                      setVehicleItemError('');
                                      try {
                                        const file_base64 = await fileToBase64(file);
                                        const data = await apiJson<VehicleFleetUploadApiResponse>(
                                          moduleClientOperationsAccountingVehicleFleetUpload(clientId),
                                          {
                                            method: 'POST',
                                            body: JSON.stringify({
                                              file_name: file.name,
                                              mime_type: file.type || null,
                                              file_base64,
                                            }),
                                          }
                                        );
                                        patchVehicleItemDraft({
                                          [f.key]: data.file_asset_id,
                                          [nameKey]: data.file_name,
                                        });
                                        setTab(data.client_operations_case.accounting_settings_tab ?? null);
                                        onAccountingCaseUpdated(data.client_operations_case);
                                      } catch (err) {
                                        setVehicleItemError(userFacingApiMessage(err));
                                      } finally {
                                        setVehicleFileUploadKey(null);
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                                    disabled={vehicleFileUploadKey === f.key}
                                    onClick={() => document.getElementById(`vf-file-${f.key}`)?.click()}
                                  >
                                    {vehicleFileUploadKey === f.key ? 'מעלה…' : 'העלאת קובץ'}
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      }
                      return fieldWrap(
                        <div className="client-field client-field-full" key={f.key}>
                          <div className="client-field-label">{f.label}</div>
                          <div style={{ fontSize: 12, color: '#9ca3af' }}>שדה לא נתמך: {f.type}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : null}
              {vehicleItemError ? <p style={{ color: '#b91c1c', fontWeight: 700 }}>{vehicleItemError}</p> : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {vehicleItemModal?.can_edit ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                  style={{ minWidth: 96 }}
                  onClick={() => void saveVehicleItem()}
                >
                  שמירה
                </button>
              ) : null}
              <button
                type="button"
                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                style={{ minWidth: 96 }}
                onClick={() => setVehicleItemOpen(false)}
              >
                סגירה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {emAddFieldOpen ? (
        <div
          className="nx-modal-overlay"
          style={{ zIndex: 10001 }}
          role="presentation"
          onClick={() => {
            if (emAddSaving) return;
            setEmAddFieldOpen(false);
            setEmAddFieldError('');
          }}
        >
          <div
            className="nx-modal nx-accounting-editor-modal"
            style={{ maxWidth: 520, direction: 'rtl' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">הוספת שדה</h3>
            </div>
            <div
              className="nx-modal-body"
              style={{ maxHeight: 'min(72vh, 560px)', overflowY: 'auto' }}
            >
              <div className="client-field">
                <div className="client-field-label">שם שדה</div>
                <input
                  type="text"
                  value={emAddLabel}
                  onChange={(e) => {
                    setEmAddLabel(e.target.value);
                    setEmAddFieldError('');
                  }}
                  maxLength={80}
                  disabled={emAddSaving}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee', font: 'inherit' }}
                />
              </div>
              <div className="client-field" style={{ marginTop: 12 }}>
                <div className="client-field-label">סוג שדה</div>
                <select
                  value={emAddFieldType}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEmAddFieldType(v);
                    setEmAddFieldError('');
                    if (expenseMgmtAddFieldNeedsOptions(v)) {
                      const cap =
                        modal?.expense_management_modal_meta?.custom_field_options_max_count ??
                        EM_ADD_OPTIONS_MAX_FALLBACK;
                      setEmAddOptionRowCount(1);
                      setEmAddOptionRows(emptyEmOptionRows(cap));
                    }
                  }}
                  disabled={emAddSaving}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #dbe3ee', font: 'inherit' }}
                >
                  <option value="">
                    {modal?.expense_management_modal_meta?.custom_field_type_placeholder_he ??
                      modal?.expense_management_modal_meta?.custom_field_type_default ??
                      'בחר'}
                  </option>
                  {(modal?.expense_management_modal_meta?.custom_field_type_options ?? []).map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const req =
                  modal?.expense_management_modal_meta?.custom_field_types_requiring_options ?? [
                    ...EM_ADD_FIELD_TYPES_NEED_OPTIONS,
                  ];
                const showOptions =
                  expenseMgmtAddFieldNeedsOptions(emAddFieldType) ||
                  (emAddFieldType ? req.includes(emAddFieldType) : false);
                const optCap =
                  modal?.expense_management_modal_meta?.custom_field_options_max_count ?? EM_ADD_OPTIONS_MAX_FALLBACK;
                const countLbl =
                  modal?.expense_management_modal_meta?.custom_field_options_count_label_he ??
                  'מספר שורות / אפשרויות';
                const rowLbl =
                  modal?.expense_management_modal_meta?.custom_field_option_value_label_he ?? 'שם אפשרות';
                const n = Math.min(Math.max(1, emAddOptionRowCount), optCap);
                return showOptions ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="client-field">
                      <div className="client-field-label">{countLbl} (עד {optCap})</div>
                      <select
                        value={n}
                        onChange={(e) => {
                          const nextN = Number(e.target.value);
                          setEmAddOptionRowCount(nextN);
                          setEmAddFieldError('');
                          setEmAddOptionRows((prev) => {
                            const base =
                              prev.length === optCap
                                ? [...prev]
                                : emptyEmOptionRows(optCap).map((_, j) => prev[j] ?? '');
                            for (let j = nextN; j < optCap; j++) base[j] = '';
                            return base;
                          });
                        }}
                        disabled={emAddSaving}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid #dbe3ee',
                          font: 'inherit',
                        }}
                      >
                        {Array.from({ length: optCap }, (_, i) => i + 1).map((num) => (
                          <option key={num} value={num}>
                            {num}
                          </option>
                        ))}
                      </select>
                    </div>
                    {Array.from({ length: n }, (_, i) => (
                      <div className="client-field" key={i} style={{ marginTop: 10 }}>
                        <div className="client-field-label">
                          {rowLbl} {i + 1}
                        </div>
                        <input
                          type="text"
                          value={emAddOptionRows[i] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEmAddOptionRows((prev) => {
                              const base =
                                prev.length === optCap
                                  ? [...prev]
                                  : emptyEmOptionRows(optCap).map((_, j) => prev[j] ?? '');
                              base[i] = v;
                              return base;
                            });
                            setEmAddFieldError('');
                          }}
                          maxLength={200}
                          disabled={emAddSaving}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: '1px solid #dbe3ee',
                            font: 'inherit',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null;
              })()}
              {emAddFieldError ? (
                <p style={{ color: '#b91c1c', fontWeight: 700, marginTop: 12, marginBottom: 0 }}>{emAddFieldError}</p>
              ) : null}
              {(() => {
                if (emAddSaving || !emAddFieldType || !expenseMgmtAddFieldNeedsOptions(emAddFieldType)) return null;
                const optCap =
                  modal?.expense_management_modal_meta?.custom_field_options_max_count ?? EM_ADD_OPTIONS_MAX_FALLBACK;
                const n = Math.min(Math.max(1, emAddOptionRowCount), optCap);
                const parts = emAddOptionRows.slice(0, n).map((s) => String(s).trim());
                const incomplete = parts.some((p) => !p);
                return incomplete ? (
                  <p style={{ color: '#6b7280', fontWeight: 600, fontSize: 13, marginTop: 10, marginBottom: 0 }}>
                    מלאו שם לכל {n} האפשרויות (רשימה או תיבות סימון).
                  </p>
                ) : null;
              })()}
              {!emAddSaving && emAddFieldType && !emAddLabel.trim() ? (
                <p style={{ color: '#6b7280', fontWeight: 600, fontSize: 13, marginTop: 8, marginBottom: 0 }}>
                  נא להזין שם שדה כדי לשמור.
                </p>
              ) : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer" style={{ justifyContent: 'center', gap: 10 }}>
              <button
                type="button"
                className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
                onClick={() => {
                  setEmAddFieldOpen(false);
                  setEmAddFieldError('');
                }}
                disabled={emAddSaving}
                style={{ minWidth: 96 }}
              >
                סגירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                onClick={() => void submitEmAddField()}
                disabled={(() => {
                  if (emAddSaving || !emAddLabel.trim() || !emAddFieldType) return true;
                  const req =
                    modal?.expense_management_modal_meta?.custom_field_types_requiring_options ?? [
                      ...EM_ADD_FIELD_TYPES_NEED_OPTIONS,
                    ];
                  const needOpts =
                    expenseMgmtAddFieldNeedsOptions(emAddFieldType) ||
                    (emAddFieldType ? req.includes(emAddFieldType) : false);
                  if (!needOpts) return false;
                  const optCap =
                    modal?.expense_management_modal_meta?.custom_field_options_max_count ?? EM_ADD_OPTIONS_MAX_FALLBACK;
                  const n = Math.min(Math.max(1, emAddOptionRowCount), optCap);
                  const parts = emAddOptionRows.slice(0, n).map((s) => String(s).trim());
                  return parts.length !== n || parts.some((p) => !p);
                })()}
                style={{ minWidth: 96 }}
              >
                {emAddSaving ? 'שומר…' : 'שמירה'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalError && !modalOpen ? <p style={{ color: '#b91c1c', marginTop: 8 }}>{modalError}</p> : null}
    </div>
  );
}

