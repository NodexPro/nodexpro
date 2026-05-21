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

export type WorkEngineInvoicesDocumentCreationEntrypoint = {
  button_label: string;
  allowed: boolean;
  allowed_action: string;
  disabled_reason: string | null;
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
    recipient_step: {
      title: string;
      description: string;
    };
    document_details_step: {
      document_date_label: string;
      document_date_required: boolean;
      notes_label: string;
    };
    income_commands: {
      select_issuer: string;
      create_customer: string;
      create_one_time_customer: string;
      create_draft: string;
      update_draft: string;
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

  return {
    button_label: '+ מסמך',
    allowed,
    allowed_action: 'open_income_document_wizard',
    disabled_reason: disabledReason,
    wizard: {
      steps: [
        { key: 'issuer_choice', label: 'בחירת מנפיק' },
        { key: 'office_client', label: 'לקוח מהמשרד', when: 'office_representative' },
        { key: 'document_type', label: 'סוג מסמך' },
        { key: 'recipient', label: 'מקבל המסמך' },
        { key: 'document_details', label: 'פרטי מסמך' },
        { key: 'preview_issue', label: 'תצוגה והפקה' },
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
      recipient_step: {
        title: 'מקבל המסמך / לקוח במסמך',
        description:
          'לקוח המשרד הוא המנפיק. כאן בוחרים את הלקוח או הנמען שמקבל את המסמך (לא את לקוח המשרד).',
      },
      document_details_step: {
        document_date_label: 'תאריך מסמך',
        document_date_required: true,
        notes_label: 'הערות',
      },
      income_commands: {
        select_issuer: 'select_income_issuer_context',
        create_customer: 'create_income_customer',
        create_one_time_customer: 'create_one_time_income_customer',
        create_draft: 'create_income_document_draft',
        update_draft: 'update_income_document_draft',
        issue_document: 'issue_income_document',
      },
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
