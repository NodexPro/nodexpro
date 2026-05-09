import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { buildNotesCellDisplayHe, loadNotesAggregatesByClient } from './client-operations-notes.service.js';
import { computeNationalInsuranceDeductionsRegistryDisplayHe, getClientTaxSettings, syncVatPaturForOsekPaturBusinessType, } from './client-tax-settings.service.js';
import { buildTaxTabWorkspaceReadModel, } from './client-tax-tab-read-model.service.js';
import { getClientBusinessProfileSection } from './client-business-profile.service.js';
import { getAccountingSettingsTabReadModel } from './client-accounting-tab.service.js';
import { getFeesTabReadModel, } from './client-fees-tab.service.js';
import { getPayrollTabReadModel } from './client-payroll-tab.service.js';
import { getAnnualTabReadModel } from './client-annual-report-tab.service.js';
import { getClientDocumentsTabReadModel } from './client-documents-tab.service.js';
import { getClientHistoryTabReadModel, } from './client-history-tab.service.js';
import { getClientObligationsTabReadModel, getClientTasksTabReadModel, recomputeClientObligationsAndTasks, } from './client-obligations-tasks-core.service.js';
import { formatNationalInsuranceRegistryDisplayHe } from './national-insurance-registry.js';
import { computeVatDueRegistryDisplayHe, computeVatRegistryColumnDisplayHe } from './vat-divuach.js';
const PROFILE_SELECT = [
    'client_id',
    'business_type',
    'payroll_flag',
    'material_brought_flag',
    'vat_status',
    'income_tax_advance_status',
    'national_insurance_status',
    'national_insurance_deductions_status',
    'income_tax_deductions_status',
    'assigned_handler_user_id',
    'notes_summary',
    'salary_data_received_flag',
    'income_data_received_flag',
].join(',');
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
export async function listClientOperationsRegistry(ctx) {
    const orgId = assertOrg(ctx);
    const { data: clients } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, tax_id')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('display_name', { ascending: true });
    const safeClients = (clients ?? []);
    if (safeClients.length === 0) {
        return { rows: [] };
    }
    const clientIds = safeClients.map((c) => c.id);
    const { data: profiles } = await supabaseAdmin
        .from('client_operational_profiles')
        .select(PROFILE_SELECT)
        .eq('organization_id', orgId)
        .in('client_id', clientIds);
    const profilesByClientId = new Map();
    for (const p of (profiles ?? [])) {
        profilesByClientId.set(p.client_id, p);
    }
    const notesByClient = await loadNotesAggregatesByClient(orgId, clientIds);
    const { data: taxSettingsRows } = await supabaseAdmin
        .from('client_tax_settings')
        .select('client_id, vat_due_type, vat_frequency, vat_type, national_insurance_type, national_insurance_monthly_amount, income_tax_deductions_enabled, income_tax_deductions_file_number, income_tax_deductions_frequency')
        .eq('organization_id', orgId)
        .in('client_id', clientIds);
    const taxByClient = new Map();
    for (const t of (taxSettingsRows ?? [])) {
        taxByClient.set(t.client_id, {
            vat_due_type: t.vat_due_type,
            vat_frequency: t.vat_frequency,
            vat_type: t.vat_type,
            national_insurance_type: t.national_insurance_type,
            national_insurance_monthly_amount: t.national_insurance_monthly_amount,
            income_tax_deductions_enabled: Boolean(t.income_tax_deductions_enabled),
            income_tax_deductions_file_number: t.income_tax_deductions_file_number,
            income_tax_deductions_frequency: t.income_tax_deductions_frequency,
        });
    }
    const rows = safeClients.map((c) => {
        const p = profilesByClientId.get(c.id);
        const noteAgg = buildNotesCellDisplayHe(notesByClient.get(c.id) ?? []);
        const tax = taxByClient.get(c.id);
        const vat_due_registry_display_he = tax
            ? computeVatDueRegistryDisplayHe(tax.vat_due_type, tax.vat_frequency)
            : null;
        const bt = p?.business_type ?? null;
        const vatFromTax = tax
            ? computeVatRegistryColumnDisplayHe(bt, tax.vat_type, tax.vat_frequency)
            : computeVatRegistryColumnDisplayHe(bt, null, null);
        const niFromTax = tax
            ? formatNationalInsuranceRegistryDisplayHe(tax.national_insurance_type, tax.national_insurance_monthly_amount)
            : null;
        const incomeDedProfile = p?.income_tax_deductions_status ?? null;
        const niDedFromTax = tax != null
            ? computeNationalInsuranceDeductionsRegistryDisplayHe({
                income_tax_deductions_enabled: tax.income_tax_deductions_enabled,
                income_tax_deductions_file_number: tax.income_tax_deductions_file_number,
                income_tax_deductions_frequency: tax.income_tax_deductions_frequency,
            }, incomeDedProfile)
            : computeNationalInsuranceDeductionsRegistryDisplayHe(null, incomeDedProfile);
        return {
            client_id: c.id,
            client_name: c.display_name,
            tax_id: c.tax_id,
            business_type: bt,
            payroll_flag: p?.payroll_flag ?? null,
            material_brought_flag: p?.material_brought_flag ?? null,
            /** מע״מ: תדירות מע״מ ממיסים; עוסק פטור — פטור */
            vat_status: vatFromTax ?? p?.vat_status ?? null,
            income_tax_advance_status: p?.income_tax_advance_status ?? null,
            /** ביטוח לאומי: סכום חודשי ממיסים כשכן */
            national_insurance_status: niFromTax ?? p?.national_insurance_status ?? null,
            /** ביטוח לאומי ניכויים — מחושב ממיסים + סטטוס מס הכנסה ניכויים (לא → לא רלוונטי). */
            national_insurance_deductions_status: niDedFromTax ?? p?.national_insurance_deductions_status ?? null,
            income_tax_deductions_status: p?.income_tax_deductions_status ?? null,
            assigned_handler_user_id: p?.assigned_handler_user_id ?? null,
            notes_cell_text_he: noteAgg.cell_text_he,
            operational_notes_count: noteAgg.count,
            vat_due_registry_display_he,
        };
    });
    return { rows };
}
export async function getClientOperationsCase(ctx, clientId, options) {
    const orgId = assertOrg(ctx);
    const [{ data: client, error: clientErr }, { data: primaryContact }, { data: profile }] = await Promise.all([
        supabaseAdmin
            .from('clients')
            .select('id, display_name, tax_id, status, email, phone, address, city, notes, created_at, ended_at')
            .eq('organization_id', orgId)
            .eq('id', clientId)
            .single(),
        supabaseAdmin
            .from('client_contacts')
            .select('full_name, email, phone, title')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('is_primary', true)
            .maybeSingle(),
        supabaseAdmin.from('client_operational_profiles').select(PROFILE_SELECT).eq('organization_id', orgId).eq('client_id', clientId).maybeSingle(),
    ]);
    if (clientErr) {
        if (clientErr.code === 'PGRST116' || !client)
            throw forbidden('Client not found');
        const errMsg = 'message' in clientErr ? String(clientErr.message ?? '') : '';
        throw new AppError(500, errMsg || 'clients query failed', 'SUPABASE_ERROR');
    }
    if (!client)
        throw forbidden('Client not found');
    let assignedHandlerFullName = null;
    const handlerId = profile?.assigned_handler_user_id ?? null;
    const handlerMemQuery = handlerId
        ? supabaseAdmin
            .from('organization_users')
            .select('user_id, users!organization_users_user_id_fkey(full_name, email)')
            .eq('organization_id', orgId)
            .eq('user_id', handlerId)
            .eq('membership_status', 'active')
            .not('invited_by', 'is', null)
            .maybeSingle()
        : Promise.resolve({ data: null });
    const handlerListQuery = supabaseAdmin
        .from('organization_users')
        .select('user_id, users!organization_users_user_id_fkey(id, email, full_name)')
        .eq('organization_id', orgId)
        .eq('membership_status', 'active')
        .not('invited_by', 'is', null);
    const [handlerMemRes, handlerOrgRes] = await Promise.all([handlerMemQuery, handlerListQuery]);
    const handlerMem = handlerMemRes.data;
    const handlerUserRaw = handlerMem?.users;
    const handlerUser = Array.isArray(handlerUserRaw)
        ? handlerUserRaw[0]
        : handlerUserRaw;
    if (handlerUser) {
        const fullName = handlerUser.full_name ?? null;
        const email = handlerUser.email ?? null;
        assignedHandlerFullName = fullName?.trim() ? fullName : email;
    }
    const { data: handlerOrgRows, error: handlerOptsErr } = handlerOrgRes;
    if (handlerOptsErr) {
        throw new AppError(500, handlerOptsErr.message ?? 'organization_users (handlers) query failed', 'SUPABASE_ERROR');
    }
    const handler_user_options = (handlerOrgRows ?? [])
        .map((r) => {
        const uRaw = r.users;
        const u = Array.isArray(uRaw) ? uRaw[0] : uRaw;
        if (!u || !r.user_id)
            return null;
        const email = u.email ?? '';
        const display_name = u.full_name?.trim() ? u.full_name.trim() : email;
        return { user_id: r.user_id, email, display_name };
    })
        .filter((x) => x != null && Boolean(x.user_id && x.email))
        .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'he'));
    const chartView = options?.feesPriceChartView ?? 'last_15';
    const historyOpen = options?.historyOpenSection ?? null;
    await recomputeClientObligationsAndTasks(ctx, clientId, new Date());
    const [tax_settings, accounting, accounting_settings_tab, fees_tab, payroll_tab, annual_tab, capital_declaration_tab, client_documents_tab, client_history_tab, client_obligations_tab, client_tasks_tab,] = await Promise.all([
        getClientTaxSettings(ctx, clientId),
        getClientBusinessProfileSection(ctx, clientId),
        getAccountingSettingsTabReadModel(ctx, clientId),
        getFeesTabReadModel(ctx, clientId, chartView),
        getPayrollTabReadModel(ctx, clientId),
        getAnnualTabReadModel(ctx, clientId),
        getAnnualTabReadModel(ctx, clientId, 'capital_declaration'),
        getClientDocumentsTabReadModel(ctx, clientId, {
            skipEnsureDefaultFolders: options?.skipEnsureClientDocumentFolders === true,
        }),
        getClientHistoryTabReadModel(ctx, clientId, historyOpen),
        getClientObligationsTabReadModel(ctx, clientId),
        getClientTasksTabReadModel(ctx, clientId),
    ]);
    return {
        client: {
            id: client.id,
            client_name: client.display_name,
            tax_id: client.tax_id,
            status: client.status ?? null,
            started_at: client.created_at ?? null,
            ended_at: client.ended_at ?? null,
            email: client.email ?? null,
            phone: client.phone ?? null,
            address: client.address ?? null,
            city: client.city ?? null,
            notes: client.notes ?? null,
        },
        primary_contact: primaryContact
            ? {
                full_name: primaryContact.full_name ?? null,
                email: primaryContact.email ?? null,
                phone: primaryContact.phone ?? null,
                title: primaryContact.title ?? null,
            }
            : null,
        handler_user_options,
        profile: (() => {
            const p = profile;
            return {
                business_type: p?.business_type ?? null,
                payroll_flag: p?.payroll_flag ?? null,
                material_brought_flag: p?.material_brought_flag ?? null,
                vat_status: p?.vat_status ?? null,
                income_tax_advance_status: p?.income_tax_advance_status ?? null,
                national_insurance_status: p?.national_insurance_status ?? null,
                national_insurance_deductions_status: p?.national_insurance_deductions_status ?? null,
                income_tax_deductions_status: p?.income_tax_deductions_status ?? null,
                assigned_handler_user_id: p?.assigned_handler_user_id ?? null,
                assigned_handler_user_full_name: assignedHandlerFullName,
                notes_summary: p?.notes_summary ?? null,
                salary_data_received_flag: p?.salary_data_received_flag ?? null,
                income_data_received_flag: p?.income_data_received_flag ?? null,
            };
        })(),
        tax_settings,
        tax_tab: buildTaxTabWorkspaceReadModel(tax_settings),
        accounting,
        accounting_settings_tab,
        fees_tab,
        payroll_tab,
        annual_tab,
        capital_declaration_tab,
        client_documents_tab,
        client_history_tab,
        client_obligations_tab,
        client_tasks_tab,
    };
}
const ALLOWED_BUSINESS_TYPES = new Set(['עוסק פטור', 'עוסק מורשה', 'חברה', 'תאגיד', 'אחר']);
const ALLOWED_CLIENT_STATUSES = new Set(['active', 'inactive', 'pending']);
function normalizeOptionalString(v) {
    if (v === undefined)
        return null;
    if (v === null)
        return null;
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    return s === '' ? null : s;
}
function parseAddressCombined(addressText) {
    const trimmed = addressText.trim();
    if (!trimmed)
        return { street: null, city: null };
    // UI uses ` · ` between address and city.
    const partsByMiddleDot = trimmed.split(' · ').map((p) => p.trim()).filter(Boolean);
    if (partsByMiddleDot.length >= 2) {
        const city = partsByMiddleDot[partsByMiddleDot.length - 1] ?? null;
        const street = partsByMiddleDot.slice(0, -1).join(' · ') || null;
        return { street, city };
    }
    // Fallback: split on middle dot with optional spaces.
    const partsByDot = trimmed.split(/\s*·\s*/g).map((p) => p.trim()).filter(Boolean);
    if (partsByDot.length >= 2) {
        const city = partsByDot[partsByDot.length - 1] ?? null;
        const street = partsByDot.slice(0, -1).join(' · ') || null;
        return { street, city };
    }
    return { street: trimmed, city: null };
}
function parseEndedAtDate(dateValue) {
    if (dateValue === undefined)
        return null;
    if (dateValue === null)
        return null;
    if (typeof dateValue !== 'string')
        return null;
    const s = dateValue.trim();
    if (!s)
        return null;
    const iso = new Date(`${s}T00:00:00.000Z`).toISOString();
    return iso;
}
/**
 * Save only the "פרטי לקוח" first-tab fields (clients + client_operational_profiles + primary client contact).
 * Backend owns all validations and uniqueness rules.
 */
export async function updateClientOperationsClientProfile(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    const clientName = String(body.client_name ?? '').trim();
    const taxId = String(body.government_id ?? '').trim();
    const businessType = String(body.business_type ?? '').trim();
    const status = String(body.status ?? '').trim();
    if (!clientName)
        throw badRequest('שם לקוח is required');
    if (!taxId)
        throw badRequest('ת.ז / ח.פ is required');
    if (!businessType)
        throw badRequest('סוג עסק is required');
    if (!ALLOWED_BUSINESS_TYPES.has(businessType))
        throw badRequest('Invalid business type');
    if (!status || !ALLOWED_CLIENT_STATUSES.has(status))
        throw badRequest('Invalid client status');
    const { data: existingClient } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, tax_id, status, email, phone, address, city, created_at, ended_at')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!existingClient)
        throw forbidden('Client not found');
    const { data: existingProfile } = await supabaseAdmin
        .from('client_operational_profiles')
        .select('assigned_handler_user_id, business_type')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    // Enforce uniqueness of tax_id (government_id) within org.
    if (taxId !== existingClient.tax_id) {
        const { data: dup } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('organization_id', orgId)
            .eq('tax_id', taxId)
            .maybeSingle();
        if (dup)
            throw conflict('A client with this tax ID (HP) already exists');
    }
    const phone = body.phone !== undefined ? normalizeOptionalString(body.phone) : existingClient.phone ?? null;
    const email = body.email !== undefined ? normalizeOptionalString(body.email) : existingClient.email ?? null;
    const newPhone = phone?.trim() ?? null;
    const newEmail = email?.trim() ?? null;
    if (!newPhone && !newEmail) {
        throw badRequest('Client must have at least one contact method: phone or email.');
    }
    const endedAt = body.ended_at !== undefined ? parseEndedAtDate(body.ended_at) : (existingClient.ended_at ?? null);
    // Assigned handler validation (must be an active invited member of the same org).
    const assigned_handler_user_id = body.assigned_handler_user_id !== undefined
        ? body.assigned_handler_user_id
            ? String(body.assigned_handler_user_id)
            : null
        : (existingProfile?.assigned_handler_user_id ?? null);
    if (assigned_handler_user_id) {
        const { data: ou } = await supabaseAdmin
            .from('organization_users')
            .select('id, invited_by')
            .eq('organization_id', orgId)
            .eq('user_id', assigned_handler_user_id)
            .eq('membership_status', 'active')
            .not('invited_by', 'is', null)
            .maybeSingle();
        if (!ou)
            throw forbidden('Assigned accountant must be a confirmed invited member of this organization');
    }
    const addressCombined = body.address !== undefined ? body.address : null;
    const combined = addressCombined !== undefined && addressCombined !== null
        ? String(addressCombined)
        : [existingClient.address, existingClient.city].filter(Boolean).join(' · ');
    const parsedAddress = parseAddressCombined(combined || '');
    // 1) Update clients table fields.
    const { data: updatedClient, error: updateClientError } = await supabaseAdmin
        .from('clients')
        .update({
        updated_at: new Date().toISOString(),
        display_name: clientName,
        tax_id: taxId,
        status,
        email: newEmail,
        phone: newPhone,
        address: parsedAddress.street,
        city: parsedAddress.city,
        ended_at: endedAt,
    })
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .select()
        .maybeSingle();
    if (updateClientError || !updatedClient) {
        throw new AppError(500, updateClientError?.message ?? 'Failed to update client profile', 'CLIENT_PROFILE_UPDATE_FAILED');
    }
    // 2) Update module profile: business type + assigned handler.
    await supabaseAdmin.from('client_operational_profiles').upsert({
        organization_id: orgId,
        client_id: clientId,
        business_type: businessType,
        assigned_handler_user_id: assigned_handler_user_id,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,client_id' });
    await syncVatPaturForOsekPaturBusinessType(ctx, clientId, businessType);
    // 3) Update primary contact full_name (and optionally phone/email for display consistency).
    const { data: primaryContact } = await supabaseAdmin
        .from('client_contacts')
        .select('id, full_name')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('is_primary', true)
        .maybeSingle();
    if (body.contact_person !== undefined) {
        const contactFullName = normalizeOptionalString(body.contact_person);
        // Allow profile save when contact name is blank; keep existing primary contact name unchanged.
        if (contactFullName) {
            if (primaryContact) {
                await supabaseAdmin
                    .from('client_contacts')
                    .update({
                    full_name: contactFullName,
                    email: newEmail,
                    phone: newPhone,
                    updated_at: new Date().toISOString(),
                })
                    .eq('id', primaryContact.id)
                    .eq('organization_id', orgId);
            }
            else {
                await supabaseAdmin.from('client_contacts').insert({
                    organization_id: orgId,
                    client_id: clientId,
                    full_name: contactFullName,
                    email: newEmail,
                    phone: newPhone,
                    title: null,
                    is_primary: true,
                    status: 'active',
                    created_by: ctx.user.id,
                });
            }
        }
    }
    const changes = {};
    if (String(existingClient.display_name ?? '').trim() !== clientName) {
        changes.display_name = { before: existingClient.display_name, after: clientName };
    }
    if (String(existingClient.tax_id ?? '').trim() !== taxId) {
        changes.tax_id = { before: existingClient.tax_id, after: taxId };
    }
    if (String(existingClient.status ?? '').trim() !== status) {
        changes.status = { before: existingClient.status, after: status };
    }
    if ((existingClient.email ?? null) !== newEmail)
        changes.email = { before: existingClient.email, after: newEmail };
    if ((existingClient.phone ?? null) !== newPhone)
        changes.phone = { before: existingClient.phone, after: newPhone };
    if ((existingClient.ended_at ?? null) !== endedAt)
        changes.ended_at = { before: existingClient.ended_at, after: endedAt };
    if ((existingClient.address ?? null) !== parsedAddress.street || (existingClient.city ?? null) !== parsedAddress.city) {
        changes.address = { before: { street: existingClient.address, city: existingClient.city }, after: parsedAddress };
    }
    const prevBt = existingProfile?.business_type ?? null;
    if (prevBt !== businessType)
        changes.business_type = { before: prevBt, after: businessType };
    if ((existingProfile?.assigned_handler_user_id ?? null) !== assigned_handler_user_id) {
        changes.assigned_handler_user_id = {
            before: existingProfile?.assigned_handler_user_id ?? null,
            after: assigned_handler_user_id,
        };
    }
    if (body.contact_person !== undefined) {
        const contactFullName = normalizeOptionalString(body.contact_person);
        const prevName = primaryContact?.full_name ?? null;
        if (contactFullName !== prevName) {
            changes.primary_contact_full_name = { before: prevName, after: contactFullName };
        }
    }
    if (Object.keys(changes).length > 0) {
        await writeAudit({
            organizationId: orgId,
            actorUserId: ctx.user.id,
            moduleCode: 'client-operations',
            entityType: 'client_operations_workspace_profile',
            entityId: clientId,
            action: AUDIT_ACTIONS.CLIENT_OPERATIONS_WORKSPACE_PROFILE_UPDATED,
            payload: { client_id: clientId, changes },
        });
    }
    return getClientOperationsCase(ctx, clientId);
}
