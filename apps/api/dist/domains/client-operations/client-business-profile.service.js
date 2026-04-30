import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
const BUSINESS_OPERATION_MODE_OPTIONS = [
    { value: 'services', label: 'שירותים' },
    { value: 'trade', label: 'מסחר' },
    { value: 'online', label: 'אונליין' },
    { value: 'freelancer', label: 'פרילנס' },
    { value: 'manufacturing', label: 'ייצור' },
    { value: 'mixed', label: 'מעורב' },
];
const PRIMARY_CUSTOMER_TYPE_OPTIONS = [
    { value: 'private', label: 'פרטי' },
    { value: 'business', label: 'עסקי' },
    { value: 'mixed', label: 'מעורב' },
];
const BUSINESS_PROFILE_DB_COMPARE_KEYS = [
    'business_domain',
    'business_activity_description',
    'business_address',
    'private_address',
    'business_operation_mode',
    'primary_customer_type',
    'is_seasonal_business',
    'peak_months',
    'business_open_date',
    'business_close_date',
    'has_business_vehicles',
];
const PEAK_MONTHS_OPTIONS = [
    { value: 1, label: 'ינואר' },
    { value: 2, label: 'פברואר' },
    { value: 3, label: 'מרץ' },
    { value: 4, label: 'אפריל' },
    { value: 5, label: 'מאי' },
    { value: 6, label: 'יוני' },
    { value: 7, label: 'יולי' },
    { value: 8, label: 'אוגוסט' },
    { value: 9, label: 'ספטמבר' },
    { value: 10, label: 'אוקטובר' },
    { value: 11, label: 'נובמבר' },
    { value: 12, label: 'דצמבר' },
];
const BOOL_OPTIONS = [
    { value: true, label: 'כן' },
    { value: false, label: 'לא' },
];
const BUSINESS_PROFILE_GROUPS = {
    business_scope: { label: 'תחום העסק', order: 1 },
    address: { label: 'כתובת', order: 2 },
    general_info: { label: 'מידע כללי', order: 3 },
};
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
async function ensureClientInOrg(orgId, clientId) {
    const { data } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
    if (!data)
        throw forbidden('Client not found');
}
function parseDateOnlyOptional(v) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== 'string')
        throw badRequest('Invalid date');
    const s = v.trim();
    if (!s)
        return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw badRequest('Invalid date');
    const d = new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()))
        throw badRequest('Invalid date');
    return s;
}
function normalizeTextOptional(v, maxLen) {
    if (v === undefined || v === null)
        return null;
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    if (!s)
        return null;
    if (s.length > maxLen)
        throw badRequest(`Text too long (max ${maxLen})`);
    return s;
}
function uniqueSortedMonths(months) {
    const uniq = Array.from(new Set(months));
    uniq.sort((a, b) => a - b);
    return uniq;
}
export async function getClientBusinessProfileSection(ctx, clientId) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    const perms = ctx.membership?.permissions ?? [];
    // Backward compatible: client_operations.* implies access; dedicated business_profile.* is preferred.
    const canView = perms.includes('business_profile.view') || perms.includes('client_operations.view');
    const canEdit = perms.includes('business_profile.edit') || perms.includes('client_operations.edit');
    const { data: row, error } = await supabaseAdmin
        .from('client_accounting_settings')
        .select('business_domain, business_activity_description, business_address, private_address, business_operation_mode, primary_customer_type, is_seasonal_business, peak_months, business_open_date, business_close_date, has_business_vehicles, version')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_accounting_settings read failed', 'SUPABASE_ERROR');
    const r = (row ?? {});
    const isSeasonal = Boolean(r.is_seasonal_business ?? false);
    const peakMonthsRaw = r.peak_months ?? [];
    const peakMonths = uniqueSortedMonths(Array.isArray(peakMonthsRaw) ? peakMonthsRaw : []);
    const version = typeof r.version === 'number' ? r.version : 0;
    // UI: hide only "עסק עונתי" toggle (per request).
    // UX: keep "חודשי עומס" editable; backend will infer seasonality from chosen months on save.
    const seasonalToggleVisible = false;
    const visiblePeakMonths = true;
    const section = {
        section_key: 'business_profile',
        section_label: 'פרופיל עסקי',
        permissions: {
            can_view_business_profile: canView,
            can_edit_business_profile: canEdit,
        },
        version,
        fields: [
            {
                key: 'business_domain',
                label: 'תחום עיסוק',
                type: 'text',
                value: r.business_domain ?? null,
                options: undefined,
                required: false,
                editable: canEdit,
                visible: true,
                max_length: 200,
                group_key: 'business_scope',
                group_label: BUSINESS_PROFILE_GROUPS.business_scope.label,
                group_order: BUSINESS_PROFILE_GROUPS.business_scope.order,
                row_order: 1,
            },
            {
                key: 'business_activity_description',
                label: 'תיאור קצר של הפעילות',
                type: 'textarea',
                value: r.business_activity_description ?? null,
                required: false,
                editable: canEdit,
                visible: true,
                max_length: 1000,
                group_key: 'business_scope',
                group_label: BUSINESS_PROFILE_GROUPS.business_scope.label,
                group_order: BUSINESS_PROFILE_GROUPS.business_scope.order,
                row_order: 2,
            },
            {
                key: 'business_address',
                label: 'כתובת עסקי',
                type: 'text',
                value: r.business_address ?? null,
                required: false,
                editable: canEdit,
                visible: true,
                max_length: 500,
                group_key: 'address',
                group_label: BUSINESS_PROFILE_GROUPS.address.label,
                group_order: BUSINESS_PROFILE_GROUPS.address.order,
                row_order: 1,
            },
            {
                key: 'private_address',
                label: 'כתובת פרטי',
                type: 'text',
                value: r.private_address ?? null,
                required: false,
                editable: canEdit,
                visible: true,
                max_length: 500,
                group_key: 'address',
                group_label: BUSINESS_PROFILE_GROUPS.address.label,
                group_order: BUSINESS_PROFILE_GROUPS.address.order,
                row_order: 2,
            },
            {
                key: 'business_operation_mode',
                label: 'אופן פעילות עיקרי',
                type: 'enum_single',
                value: r.business_operation_mode ?? null,
                options: BUSINESS_OPERATION_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                required: false,
                editable: canEdit,
                visible: true,
                group_key: 'business_scope',
                group_label: BUSINESS_PROFILE_GROUPS.business_scope.label,
                group_order: BUSINESS_PROFILE_GROUPS.business_scope.order,
                row_order: 3,
            },
            {
                key: 'primary_customer_type',
                label: 'קהל עיקרי',
                type: 'enum_single',
                value: r.primary_customer_type ?? null,
                options: PRIMARY_CUSTOMER_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                required: false,
                editable: canEdit,
                visible: true,
                group_key: 'business_scope',
                group_label: BUSINESS_PROFILE_GROUPS.business_scope.label,
                group_order: BUSINESS_PROFILE_GROUPS.business_scope.order,
                row_order: 4,
            },
            {
                key: 'is_seasonal_business',
                label: 'עסק עונתי',
                type: 'boolean',
                value: Boolean(r.is_seasonal_business ?? false),
                options: BOOL_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                required: false,
                editable: canEdit,
                visible: seasonalToggleVisible,
                group_key: 'general_info',
                group_label: BUSINESS_PROFILE_GROUPS.general_info.label,
                group_order: BUSINESS_PROFILE_GROUPS.general_info.order,
                row_order: 1,
            },
            {
                key: 'peak_months',
                label: 'חודשי עומס',
                type: 'multi_enum',
                value: visiblePeakMonths ? peakMonths : [],
                options: PEAK_MONTHS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                required: false,
                // Validation rule is enforced on backend; UI remains backend-driven and doesn't encode business logic.
                editable: canEdit,
                visible: visiblePeakMonths,
                validation: [
                    {
                        rule_key: 'peak_months_infers_seasonal',
                        message_he: 'בחירת חודשי עומס הופכת את העסק לעונתי (לוגיקה בשרת).',
                    },
                ],
                group_key: 'general_info',
                group_label: BUSINESS_PROFILE_GROUPS.general_info.label,
                group_order: BUSINESS_PROFILE_GROUPS.general_info.order,
                row_order: 1,
            },
            {
                key: 'business_open_date',
                label: 'פתיחת עסק',
                type: 'date',
                value: r.business_open_date ?? null,
                required: false,
                editable: canEdit,
                visible: true,
                group_key: 'general_info',
                group_label: BUSINESS_PROFILE_GROUPS.general_info.label,
                group_order: BUSINESS_PROFILE_GROUPS.general_info.order,
                row_order: 2,
            },
            {
                key: 'business_close_date',
                label: 'סגירת עסק',
                type: 'date',
                value: r.business_close_date ?? null,
                required: false,
                editable: canEdit,
                visible: true,
                validation: [
                    {
                        rule_key: 'close_after_open',
                        message_he: 'תאריך סגירת העסק לא יכול להיות לפני תאריך פתיחת העסק.',
                    },
                ],
                group_key: 'general_info',
                group_label: BUSINESS_PROFILE_GROUPS.general_info.label,
                group_order: BUSINESS_PROFILE_GROUPS.general_info.order,
                row_order: 3,
            },
        ],
    };
    return section;
}
export async function saveClientBusinessProfileSection(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    const perms = ctx.membership?.permissions ?? [];
    const canEdit = perms.includes('business_profile.edit') || perms.includes('client_operations.edit');
    if (!canEdit) {
        // Route should block; still keep backend authoritative for UI payload.
        const section = await getClientBusinessProfileSection(ctx, clientId);
        return { ok: true, section };
    }
    const validationErrors = [];
    // Normalize/validate primitive values.
    let business_domain = null;
    let business_activity_description = null;
    let business_address = null;
    let private_address = null;
    let business_operation_mode = null;
    let primary_customer_type = null;
    let peak_months = Array.isArray(body.peak_months) ? body.peak_months : [];
    // Field "עסק עונתי" is hidden in UI; backend infers it from peak_months.
    let is_seasonal_business = false;
    let business_open_date = null;
    let business_close_date = null;
    try {
        business_domain = normalizeTextOptional(body.business_domain, 200);
    }
    catch {
        validationErrors.push({ key: 'business_domain', message_he: 'תחום עיסוק ארוך מדי (מקסימום 200 תווים)' });
    }
    try {
        business_activity_description = normalizeTextOptional(body.business_activity_description, 1000);
    }
    catch {
        validationErrors.push({
            key: 'business_activity_description',
            message_he: 'תיאור קצר ארוך מדי (מקסימום 1000 תווים)',
        });
    }
    try {
        business_address = normalizeTextOptional(body.business_address, 500);
    }
    catch {
        validationErrors.push({ key: 'business_address', message_he: 'כתובת עסקי ארוכה מדי (מקסימום 500 תווים)' });
    }
    try {
        private_address = normalizeTextOptional(body.private_address, 500);
    }
    catch {
        validationErrors.push({ key: 'private_address', message_he: 'כתובת פרטי ארוכה מדי (מקסימום 500 תווים)' });
    }
    const allowedOpModes = new Set(BUSINESS_OPERATION_MODE_OPTIONS.map((o) => o.value));
    if (body.business_operation_mode !== null) {
        if (!allowedOpModes.has(body.business_operation_mode)) {
            validationErrors.push({ key: 'business_operation_mode', message_he: 'אופן פעילות לא חוקי' });
        }
        else {
            business_operation_mode = body.business_operation_mode;
        }
    }
    const allowedCustomerTypes = new Set(PRIMARY_CUSTOMER_TYPE_OPTIONS.map((o) => o.value));
    if (body.primary_customer_type !== null) {
        if (!allowedCustomerTypes.has(body.primary_customer_type)) {
            validationErrors.push({ key: 'primary_customer_type', message_he: 'קהל עיקרי לא חוקי' });
        }
        else {
            primary_customer_type = body.primary_customer_type;
        }
    }
    try {
        business_open_date = parseDateOnlyOptional(body.business_open_date);
    }
    catch {
        validationErrors.push({ key: 'business_open_date', message_he: 'תאריך פתיחת עסק לא חוקי' });
    }
    try {
        business_close_date = parseDateOnlyOptional(body.business_close_date);
    }
    catch {
        validationErrors.push({ key: 'business_close_date', message_he: 'תאריך סגירת עסק לא חוקי' });
    }
    // peak_months: sanitize and validate; determines seasonality on backend.
    peak_months = uniqueSortedMonths(peak_months.map((m) => Number(m)).filter((n) => !Number.isNaN(n)));
    for (const m of peak_months) {
        if (m < 1 || m > 12) {
            validationErrors.push({ key: 'peak_months', message_he: 'חודש בעומס לא חוקי' });
            break;
        }
    }
    is_seasonal_business = peak_months.length > 0;
    if (business_open_date && business_close_date) {
        if (business_close_date < business_open_date) {
            validationErrors.push({
                key: 'business_close_date',
                message_he: 'תאריך סגירת העסק לא יכול להיות לפני תאריך פתיחת העסק.',
            });
        }
    }
    if (validationErrors.length) {
        const section = await getClientBusinessProfileSection(ctx, clientId);
        return {
            ok: false,
            code: 'VALIDATION_ERROR',
            message_he: 'נא לתקן את השדות המסומנים',
            field_errors: validationErrors,
        };
    }
    const { data: existing, error: readErr } = await supabaseAdmin
        .from('client_accounting_settings')
        .select('id, version, has_business_vehicles')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (readErr)
        throw new AppError(500, readErr.message ?? 'client_accounting_settings read failed', 'SUPABASE_ERROR');
    let has_business_vehicles;
    if (body.has_business_vehicles !== undefined) {
        has_business_vehicles = Boolean(body.has_business_vehicles);
    }
    else if (existing) {
        has_business_vehicles = Boolean(existing.has_business_vehicles);
    }
    else {
        has_business_vehicles = false;
    }
    const actorUserId = ctx.user.id;
    if (!existing) {
        // Create path: expected_version must be 0 for new rows.
        if (body.expected_version !== 0) {
            return {
                ok: false,
                code: 'VERSION_CONFLICT',
                message_he: 'המידע עודכן מאז שפתחת את הטופס. טען מחדש ונסה שוב.',
            };
        }
        const { error: insErr } = await supabaseAdmin.from('client_accounting_settings').insert({
            organization_id: orgId,
            client_id: clientId,
            business_domain,
            business_activity_description,
            business_address,
            private_address,
            business_operation_mode,
            primary_customer_type,
            is_seasonal_business,
            peak_months: is_seasonal_business ? peak_months : null,
            business_open_date,
            business_close_date,
            has_business_vehicles,
            version: 1,
            created_by: actorUserId,
            updated_by: actorUserId,
        });
        if (insErr)
            throw new AppError(500, insErr.message ?? 'client_accounting_settings insert failed', 'SUPABASE_ERROR');
        await writeAudit({
            organizationId: orgId,
            actorUserId,
            moduleCode: 'client-operations',
            entityType: 'client_accounting_business_profile',
            entityId: clientId,
            action: AUDIT_ACTIONS.CLIENT_ACCOUNTING_BUSINESS_PROFILE_CREATED,
            payload: {
                client_id: clientId,
                created: true,
                changed_fields: [
                    'business_domain',
                    'business_activity_description',
                    'business_address',
                    'private_address',
                    'business_operation_mode',
                    'primary_customer_type',
                    'is_seasonal_business',
                    'peak_months',
                    'business_open_date',
                    'business_close_date',
                    'has_business_vehicles',
                ],
                version_from: 0,
                version_to: 1,
            },
        });
        const section = await getClientBusinessProfileSection(ctx, clientId);
        return { ok: true, section };
    }
    const existingVersion = Number(existing.version ?? 0);
    if (body.expected_version !== existingVersion) {
        return {
            ok: false,
            code: 'VERSION_CONFLICT',
            message_he: 'המידע עודכן מאז שפתחת את הטופס. טען מחדש ונסה שוב.',
        };
    }
    const changedFields = [];
    const normalizedNew = {
        business_domain,
        business_activity_description,
        business_address,
        private_address,
        business_operation_mode,
        primary_customer_type,
        is_seasonal_business,
        peak_months: is_seasonal_business ? peak_months : [],
        business_open_date,
        business_close_date,
        has_business_vehicles,
    };
    const fieldsToCompare = [...BUSINESS_PROFILE_DB_COMPARE_KEYS];
    // Load old row to compute changed fields summary.
    const { data: oldRow } = await supabaseAdmin
        .from('client_accounting_settings')
        .select('business_domain, business_activity_description, business_address, private_address, business_operation_mode, primary_customer_type, is_seasonal_business, peak_months, business_open_date, business_close_date, has_business_vehicles')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    for (const fieldKey of fieldsToCompare) {
        const oldVal = oldRow?.[fieldKey];
        const newVal = normalizedNew[fieldKey];
        const normOld = fieldKey === 'peak_months' ? uniqueSortedMonths(Array.isArray(oldVal) ? oldVal : []) : oldVal ?? null;
        const normNew = fieldKey === 'peak_months' ? uniqueSortedMonths(Array.isArray(newVal) ? newVal : []) : newVal ?? null;
        if (JSON.stringify(normOld) !== JSON.stringify(normNew))
            changedFields.push(fieldKey);
    }
    const { error: updErr } = await supabaseAdmin
        .from('client_accounting_settings')
        .update({
        business_domain,
        business_activity_description,
        business_address,
        private_address,
        business_operation_mode,
        primary_customer_type,
        is_seasonal_business,
        peak_months: is_seasonal_business ? peak_months : null,
        business_open_date,
        business_close_date,
        has_business_vehicles,
        version: existingVersion + 1,
        updated_by: actorUserId,
    })
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('version', existingVersion);
    if (updErr)
        throw new AppError(500, updErr.message ?? 'client_accounting_settings update failed', 'SUPABASE_ERROR');
    await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'client-operations',
        entityType: 'client_accounting_business_profile',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_ACCOUNTING_BUSINESS_PROFILE_UPDATED,
        payload: { client_id: clientId, changed_fields: changedFields.length ? changedFields : ['none'], version_from: existingVersion, version_to: existingVersion + 1 },
    });
    const section = await getClientBusinessProfileSection(ctx, clientId);
    return { ok: true, section };
}
