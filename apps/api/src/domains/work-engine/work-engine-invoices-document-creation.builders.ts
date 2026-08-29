/**
 * INC-8.5 — Work Engine invoices tab document creation wizard schema.
 */

import type { RequestContext } from '../../shared/context.js';
import { hasPermission } from '../rbac/rbac.service.js';
import {
  buildClientOperationsAddressJson,
  clientOperationsBusinessTypeDisplayHe,
  loadClientOperationsCoreClientsForOrg,
  mapClientOperationsBusinessTypeForIncomeIssuer,
} from '../client-operations/client-operations-client-core.read.js';
import { ensureOrgIncomeIssuerProfile } from '../income/income-issuer-context.service.js';
import { loadIncomeIssuerProfileProjection } from '../income/income-issuer-profile-sync.service.js';
import { buildRecipientCreateFieldsSchema } from '../income/income-recipient.service.js';
import { INCOME_PERMISSIONS } from '../income/income.types.js';
import type { IncomeIssuerSnapshotBlock } from '../income/income-issuer-snapshot.service.js';

export type WorkEngineOfficeClientIssuerOption = {
  issuer_business_id: string;
  represented_client_id: string;
  label: string;
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  business_type_label: string | null;
  address_json: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  vat_registration_status: string | null;
  country_code: string;
  enabled: boolean;
  disabled_reason: string | null;
};

/** Static income command map for retainer setup (no office-client list load). */
export const WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS = {
  select_issuer: 'select_income_issuer_context',
  search_recipients: 'search_income_recipients',
  select_recipient: 'select_income_recipient',
  set_recipient_snapshot: 'set_income_recipient_snapshot',
  save_recipient_for_future: 'save_income_recipient_for_future',
  begin_wizard_draft: 'begin_income_wizard_document_draft',
  add_line: 'add_income_document_line',
  update_line: 'update_income_document_line',
  delete_line: 'delete_income_document_line',
  reorder_lines: 'reorder_income_document_lines',
  update_draft_settings: 'update_income_document_draft_settings',
  update_notes: 'update_income_document_notes',
  update_allocation_number: 'update_income_document_allocation_number',
  update_delivery_contact: 'update_income_document_delivery_contact',
  save_draft: 'save_income_document_draft',
  resume_draft: 'resume_income_document_draft',
  generate_preview: 'generate_income_document_preview',
  update_discount: 'update_income_document_discount',
  update_branding_profile: 'update_income_document_branding_profile',
  upload_document_logo: 'upload_income_document_logo',
  upload_document_signature: 'upload_income_document_signature',
  issue_document: 'issue_income_document',
  issue_and_send_document: 'issue_and_send_income_document',
} as const;

/**
 * Per-population +מסמך entry — backend-owned issuer entry context.
 * FE only executes select_issuer_command (when present) and opens the wizard
 * with wizard_open hints; no frontend issuer eligibility logic.
 */
export type WorkEngineInvoicesPopulationNewDocumentAction = {
  section_key: 'office_clients' | 'office_client_customers';
  button_label: string;
  enabled: boolean;
  disabled_reason: string | null;
  select_issuer_command: {
    command: 'select_income_issuer_context';
    command_payload: {
      acting_mode: 'self' | 'office_representative';
      issuer_business_id: string;
      represented_client_id: string | null;
    };
  } | null;
  wizard_open: {
    /** Seed wizard issuerChoice so office_client step visibility matches entry. */
    preset_issuer_choice_key: 'self' | 'office_client' | null;
    wizard_starting_step_key: string | null;
    /** Hide issuer_choice step when entry context already fixed the issuer type. */
    lock_issuer_choice_step: boolean;
  };
};

export type WorkEngineInvoicesDocumentCreationEntrypoint = {
  button_label: string;
  allowed: boolean;
  allowed_action: string;
  disabled_reason: string | null;
  /** Population-scoped +מסמך actions (replaces global header button). */
  population_actions: WorkEngineInvoicesPopulationNewDocumentAction[];
  wizard: {
    steps: { key: string; label: string; when?: string }[];
    issuer_choice: {
      title: string;
      options: {
        key: string;
        label: string;
        acting_mode: 'self' | 'office_representative';
        issuer_business_id: string | null;
        enabled: boolean;
        disabled_reason: string | null;
      }[];
    };
    office_client_issuer_options: WorkEngineOfficeClientIssuerOption[];
    /** Display labels for office-client prefill (same semantics as Client Operations profile). */
    office_client_display_labels: {
      tax_id_label: string;
      phone_label: string;
      email_label: string;
      address_label: string;
    };
    recipient_search: {
      label: string;
      placeholder: string;
      create_fields_schema: ReturnType<typeof buildRecipientCreateFieldsSchema>;
      save_for_future_label: string;
    };
    document_details_step: {
      document_date_label: string;
      document_date_required: boolean;
      notes_label: string;
    };
    income_commands: {
      select_issuer: string;
      search_recipients: string;
      select_recipient: string;
      set_recipient_snapshot: string;
      save_recipient_for_future: string;
      begin_wizard_draft: string;
      add_line: string;
      update_line: string;
      delete_line: string;
      reorder_lines: string;
      update_draft_settings: string;
      update_notes: string;
      update_allocation_number: string;
      update_delivery_contact: string;
      save_draft: string;
      resume_draft: string;
      generate_preview: string;
      update_discount: string;
      update_branding_profile: string;
      upload_document_logo: string;
      upload_document_signature: string;
      issue_document: string;
    };
  };
};

async function loadOfficeClientIssuerOptions(orgId: string): Promise<WorkEngineOfficeClientIssuerOption[]> {
  const coreClients = await loadClientOperationsCoreClientsForOrg(orgId);
  return coreClients.map((c) => {
    const businessTypeNorm = mapClientOperationsBusinessTypeForIncomeIssuer(c.business_type);
    return {
      issuer_business_id: c.id,
      represented_client_id: c.id,
      label: c.display_name,
      display_name: c.display_name,
      legal_name: null,
      tax_id: c.tax_id,
      business_type: businessTypeNorm,
      business_type_label: clientOperationsBusinessTypeDisplayHe(c.business_type),
      address_json: buildClientOperationsAddressJson(c.address, c.city),
      phone: c.phone,
      email: c.email,
      vat_registration_status: null,
      country_code: 'IL',
      enabled: true,
      disabled_reason: null,
    };
  });
}

export async function buildWorkEngineInvoicesDocumentCreationEntrypoint(
  ctx: RequestContext,
): Promise<WorkEngineInvoicesDocumentCreationEntrypoint> {
  const orgId = ctx.organizationId!;
  const perms = {
    view: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.view),
    edit: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.edit),
    issue: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.issue),
    issue_on_behalf: hasPermission(
      ctx.membership?.permissions ?? [],
      INCOME_PERMISSIONS.issueOnBehalf,
    ),
  };

  const allowed = perms.view && perms.edit && perms.issue;
  let disabledReason: string | null = null;
  if (!perms.view) disabledReason = 'נדרשת הרשאת income.view';
  else if (!perms.edit) disabledReason = 'נדרשת הרשאת income.edit';
  else if (!perms.issue) disabledReason = 'נדרשת הרשאת income.issue';

  const orgIssuer = await ensureOrgIncomeIssuerProfile(orgId);
  const profile = await loadIncomeIssuerProfileProjection(orgId);
  const officeName = profile?.display_name ?? orgIssuer.display_name;

  const officeClientOptions = perms.issue_on_behalf
    ? await loadOfficeClientIssuerOptions(orgId)
    : [];

  const officeClientsNewDocument: WorkEngineInvoicesPopulationNewDocumentAction = {
    section_key: 'office_clients',
    button_label: '+ מסמך',
    enabled: allowed,
    disabled_reason: disabledReason,
    // Office population → accounting office is issuer (self). Skip "מי מנפיק?".
    select_issuer_command: {
      command: 'select_income_issuer_context',
      command_payload: {
        acting_mode: 'self',
        issuer_business_id: orgIssuer.id,
        represented_client_id: null,
      },
    },
    wizard_open: {
      preset_issuer_choice_key: null,
      wizard_starting_step_key: null,
      lock_issuer_choice_step: true,
    },
  };

  const officeClientCustomersNewDocument: WorkEngineInvoicesPopulationNewDocumentAction = {
    section_key: 'office_client_customers',
    button_label: '+ מסמך',
    enabled: allowed && perms.issue_on_behalf,
    disabled_reason: !allowed
      ? disabledReason
      : !perms.issue_on_behalf
        ? 'נדרשת הרשאת income.issue_on_behalf'
        : null,
    // Customers population → represented-client issuer required; pick Test3/Test4 next.
    select_issuer_command: null,
    wizard_open: {
      preset_issuer_choice_key: 'office_client',
      wizard_starting_step_key: 'office_client',
      lock_issuer_choice_step: true,
    },
  };

  return {
    button_label: '+ מסמך',
    allowed,
    allowed_action: 'open_income_document_wizard',
    disabled_reason: disabledReason,
    population_actions: [officeClientsNewDocument, officeClientCustomersNewDocument],
    wizard: {
      steps: [
        { key: 'issuer_choice', label: 'בחירת מנפיק' },
        { key: 'office_client', label: 'לקוח מהמשרד', when: 'office_representative' },
        { key: 'document_type', label: 'סוג מסמך' },
        { key: 'recipient', label: 'מקבל המסמך' },
        { key: 'document_details', label: 'פרטי מסמך' },
        { key: 'preview', label: 'תצוגה מקדימה' },
        { key: 'issue', label: 'הפקה' },
      ],
      issuer_choice: {
        title: 'מי מנפיק את המסמך?',
        options: [
          {
            key: 'self',
            label: `המשרד — ${officeName}`,
            acting_mode: 'self',
            issuer_business_id: orgIssuer.id,
            enabled: perms.view,
            disabled_reason: perms.view ? null : 'נדרשת הרשאת income.view',
          },
          {
            key: 'office_client',
            label: 'לקוח מהמשרד',
            acting_mode: 'office_representative',
            issuer_business_id: null,
            enabled: perms.issue_on_behalf && perms.view,
            disabled_reason: !perms.issue_on_behalf
              ? 'נדרשת הרשאת income.issue_on_behalf'
              : null,
          },
        ],
      },
      office_client_issuer_options: officeClientOptions,
      office_client_display_labels: {
        tax_id_label: 'ת.ז / ח.פ',
        phone_label: 'טלפון',
        email_label: 'אימייל',
        address_label: 'כתובת',
      },
      recipient_search: {
        label: 'מקבל המסמך',
        placeholder: 'חיפוש לפי שם / ח.פ / ע.מ / טלפון / אימייל',
        create_fields_schema: buildRecipientCreateFieldsSchema(),
        save_for_future_label: 'שמור לשימוש עתידי',
      },
      document_details_step: {
        document_date_label: 'תאריך מסמך',
        document_date_required: true,
        notes_label: 'הערות',
      },
      income_commands: { ...WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS },
    },
  };
}

export function issuerSnapshotToPrefillBlock(
  snapshot: IncomeIssuerSnapshotBlock,
): Record<string, unknown> {
  return {
    display_name: snapshot.display_name,
    legal_name: snapshot.legal_name,
    tax_id: snapshot.tax_id,
    business_type: snapshot.business_type,
    business_type_label: snapshot.business_type_label,
    address_json: snapshot.address_json,
    phone: snapshot.phone,
    email: snapshot.email ?? null,
    country_code: snapshot.country_code,
    vat_registration_status: snapshot.vat_registration_status,
  };
}
