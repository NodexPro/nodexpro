/**
 * INC-8.5 — Work Engine invoices tab document creation wizard schema.
 */
import { hasPermission } from '../rbac/rbac.service.js';
import { buildClientOperationsAddressJson, clientOperationsBusinessTypeDisplayHe, loadClientOperationsCoreClientsForOrg, mapClientOperationsBusinessTypeForIncomeIssuer, } from '../client-operations/client-operations-client-core.read.js';
import { ensureOrgIncomeIssuerProfile } from '../income/income-issuer-context.service.js';
import { loadIncomeIssuerProfileProjection } from '../income/income-issuer-profile-sync.service.js';
import { buildRecipientCreateFieldsSchema } from '../income/income-recipient.service.js';
import { INCOME_PERMISSIONS } from '../income/income.types.js';
async function loadOfficeClientIssuerOptions(orgId) {
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
export async function buildWorkEngineInvoicesDocumentCreationEntrypoint(ctx) {
    const orgId = ctx.organizationId;
    const perms = {
        view: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.view),
        edit: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.edit),
        issue: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.issue),
        issue_on_behalf: hasPermission(ctx.membership?.permissions ?? [], INCOME_PERMISSIONS.issueOnBehalf),
    };
    const allowed = perms.view && perms.edit && perms.issue;
    let disabledReason = null;
    if (!perms.view)
        disabledReason = 'נדרשת הרשאת income.view';
    else if (!perms.edit)
        disabledReason = 'נדרשת הרשאת income.edit';
    else if (!perms.issue)
        disabledReason = 'נדרשת הרשאת income.issue';
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
            income_commands: {
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
                update_delivery_contact: 'update_income_document_delivery_contact',
                save_draft: 'save_income_document_draft',
                resume_draft: 'resume_income_document_draft',
                generate_preview: 'generate_income_document_preview',
                update_discount: 'update_income_document_discount',
                issue_document: 'issue_income_document',
            },
        },
    };
}
export function issuerSnapshotToPrefillBlock(snapshot) {
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
