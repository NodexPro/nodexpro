import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { assertFileAllowedForSettingsImage, validateOrgFileOwnership, } from '../file-access/file-access.service.js';
import { DEFAULT_DISPLAY_OPTIONS, DEFAULT_PAYMENT_METHODS, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR, normalizeClientBlockPosition, normalizeHexColor, optionalTrimmedString, parseDisplayOptionsJson, parsePaymentMethodsJson, resolveBrandingProfile, serializeDisplayOptionsJson, serializePaymentMethodsJson, } from './income-document-branding.pure.js';
import { INCOME_COMMAND_UPDATE_BRANDING_PROFILE, INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO, INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE, } from './income-document-branding.types.js';
const BUCKET_ORG_ASSETS = 'organization-assets';
const BRANDING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BRANDING_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
let bucketEnsured = false;
async function ensureOrgAssetsBucket() {
    if (bucketEnsured)
        return;
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET_ORG_ASSETS, { public: false });
    if (error && !error.message?.includes('already exists')) {
        console.error('[income-branding] bucket ensure failed:', error.message);
    }
    bucketEnsured = true;
}
async function fileAssetToDataUrl(fileAssetId) {
    const { data, error } = await supabaseAdmin
        .from('file_assets')
        .select('storage_bucket, storage_key, mime_type, archived_at')
        .eq('id', fileAssetId)
        .maybeSingle();
    throwIfSupabaseError(error, 'fileAssetToDataUrl');
    const row = data;
    if (!row?.storage_key || row.archived_at)
        return null;
    const bucket = row.storage_bucket ?? BUCKET_ORG_ASSETS;
    if (bucket === BUCKET_ORG_ASSETS)
        await ensureOrgAssetsBucket();
    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(row.storage_key);
    if (dlErr || !blob)
        return null;
    const buf = Buffer.from(await blob.arrayBuffer());
    const mime = (row.mime_type ?? 'image/png').split(';')[0].trim();
    return `data:${mime};base64,${buf.toString('base64')}`;
}
async function loadBrandingRow(scope) {
    const { data, error } = await supabaseAdmin
        .from('income_document_branding_profiles')
        .select('*')
        .eq('organization_id', scope.org_id)
        .eq('issuer_business_id', scope.issuer_business_id)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadBrandingRow');
    return data ?? null;
}
async function bootstrapFromOrganizationSettings(scope) {
    const { data: settings, error } = await supabaseAdmin
        .from('organization_settings')
        .select('logo_file_asset_id, signature_image_file_asset_id, display_name_on_documents, document_footer_note, display_phone_on_documents, display_website_on_documents, display_address_on_documents, display_bank_details_on_documents, bank_name, bank_branch, bank_account_number, iban, swift')
        .eq('organization_id', scope.org_id)
        .maybeSingle();
    throwIfSupabaseError(error, 'bootstrapBrandingFromOrgSettings');
    const s = settings;
    const display = {
        ...DEFAULT_DISPLAY_OPTIONS,
        show_business_phone: s?.display_phone_on_documents !== false,
        show_business_address: s?.display_address_on_documents !== false,
        show_bank_details: s?.display_bank_details_on_documents === true,
    };
    const insert = {
        organization_id: scope.org_id,
        issuer_business_id: scope.issuer_business_id,
        represented_client_id: scope.represented_client_id,
        logo_file_asset_id: s?.logo_file_asset_id ?? null,
        signature_file_asset_id: s?.signature_image_file_asset_id ?? null,
        company_subtitle: typeof s?.display_name_on_documents === 'string' ? s.display_name_on_documents : null,
        primary_color: DEFAULT_PRIMARY_COLOR,
        secondary_color: DEFAULT_SECONDARY_COLOR,
        table_header_color: DEFAULT_PRIMARY_COLOR,
        totals_color: DEFAULT_PRIMARY_COLOR,
        client_block_position: 'right',
        footer_text: typeof s?.document_footer_note === 'string' ? s.document_footer_note : null,
        bank_name: typeof s?.bank_name === 'string' ? s.bank_name : null,
        bank_branch: typeof s?.bank_branch === 'string' ? s.bank_branch : null,
        bank_account: typeof s?.bank_account_number === 'string' ? s.bank_account_number : null,
        iban: typeof s?.iban === 'string' ? s.iban : null,
        swift: typeof s?.swift === 'string' ? s.swift : null,
        email_subject_template: '{{document_type}} {{document_number}}',
        email_body_template: 'שלום,\n\nמצורף {{document_type}} מספר {{document_number}}\n\nתודה רבה.',
        display_options: serializeDisplayOptionsJson(display),
        payment_methods: serializePaymentMethodsJson(DEFAULT_PAYMENT_METHODS),
        document_attachments: [],
        default_payment_terms: null,
    };
    const { data, error: insErr } = await supabaseAdmin
        .from('income_document_branding_profiles')
        .insert(insert)
        .select('*')
        .single();
    throwIfSupabaseError(insErr, 'insertBrandingProfile');
    return data;
}
export async function ensureIncomeDocumentBrandingProfile(scope) {
    const existing = await loadBrandingRow(scope);
    if (existing)
        return existing;
    return bootstrapFromOrganizationSettings(scope);
}
export async function loadResolvedBrandingProfile(scope) {
    const row = await ensureIncomeDocumentBrandingProfile(scope);
    const logo_data_url = row.logo_file_asset_id
        ? await fileAssetToDataUrl(row.logo_file_asset_id)
        : null;
    const signature_data_url = row.signature_file_asset_id
        ? await fileAssetToDataUrl(row.signature_file_asset_id)
        : null;
    return resolveBrandingProfile(row, { logo_data_url, signature_data_url });
}
function boolField(key, label, value, editable) {
    return {
        key,
        label,
        input_type: 'boolean',
        value,
        visible: true,
        editable,
        disabled_reason: editable ? null : 'נדרשת הרשאת עריכה',
        hint: null,
    };
}
function textField(key, label, value, editable, input_type = 'text', hint = null) {
    return {
        key,
        label,
        input_type,
        value: value ?? '',
        visible: true,
        editable,
        disabled_reason: editable ? null : 'נדרשת הרשאת עריכה',
        hint,
    };
}
function colorField(key, label, value, editable) {
    return textField(key, label, value, editable, 'text', 'פורמט: #1f4b99');
}
function selectField(key, label, value, options, editable) {
    return {
        key,
        label,
        input_type: 'select',
        value,
        options,
        visible: true,
        editable,
        disabled_reason: editable ? null : 'נדרשת הרשאת עריכה',
        hint: null,
    };
}
export async function buildDocumentBrandingProfileAggregate(scope, canEdit) {
    const row = await ensureIncomeDocumentBrandingProfile(scope);
    const resolved = await loadResolvedBrandingProfile(scope);
    const editActions = canEdit ? [INCOME_COMMAND_UPDATE_BRANDING_PROFILE] : [];
    const uploadLogoActions = canEdit ? [INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO] : [];
    const uploadSigActions = canEdit ? [INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE] : [];
    const display = resolved.display_options;
    const displaySection = {
        key: 'display_options',
        title: 'תצוגה במסמך',
        save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
        allowed_actions: editActions,
        fields: [
            boolField('show_logo', 'הצג לוגו', display.show_logo, canEdit),
            boolField('show_business_address', 'הצג כתובת עסק', display.show_business_address, canEdit),
            boolField('show_business_phone', 'הצג טלפון', display.show_business_phone, canEdit),
            boolField('show_business_email', 'הצג אימייל', display.show_business_email, canEdit),
            boolField('show_business_tax_id', 'הצג ח.פ/ע.מ', display.show_business_tax_id, canEdit),
            boolField('show_due_date', 'הצג תאריך לתשלום', display.show_due_date, canEdit),
            boolField('show_payment_terms', 'הצג תנאי תשלום', display.show_payment_terms, canEdit),
            boolField('show_signature', 'הצג חתימה', display.show_signature, canEdit),
            boolField('show_footer', 'הצג כותרת תחתונה', display.show_footer, canEdit),
            boolField('show_bank_details', 'הצג פרטי בנק', display.show_bank_details, canEdit),
            boolField('show_notes', 'הצג הערות', display.show_notes, canEdit),
            boolField('show_item_index', 'הצג מספר שורה', display.show_item_index, canEdit),
            boolField('show_discount_row', 'הצג שורת הנחה', display.show_discount_row, canEdit),
            boolField('show_vat_row', 'הצג שורת מע״מ', display.show_vat_row, canEdit),
            boolField('show_currency', 'הצג מטבע בשורות', display.show_currency, canEdit),
            selectField('client_block_position', 'מיקום בלוק לקוח', display.client_block_position, [
                { value: 'right', label: 'ימין (כמו GreenInvoice)' },
                { value: 'left', label: 'שמאל' },
            ], canEdit),
            selectField('quantity_position', 'מיקום עמודת כמות', display.quantity_position, [
                { value: 'before_description', label: 'לפני תיאור' },
                { value: 'after_description', label: 'אחרי תיאור' },
            ], canEdit),
        ],
    };
    const identitySection = {
        key: 'identity',
        title: 'זהות וצבעים',
        save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
        allowed_actions: editActions,
        fields: [
            textField('company_subtitle', 'משפט שיוצג מתחת לשם העסק', resolved.company_subtitle, canEdit, 'textarea', 'מערכות הנהלת חשבונות לעסקים קטנים ובינוניים'),
            colorField('primary_color', 'צבע ראשי (כותרת / לקוח)', resolved.primary_color, canEdit),
            colorField('secondary_color', 'צבע משני (רקע)', resolved.secondary_color, canEdit),
            colorField('table_header_color', 'צבע כותרת טבלה', resolved.table_header_color, canEdit),
            colorField('totals_color', 'צבע בלוק סיכום', resolved.totals_color, canEdit),
        ],
    };
    const footerSection = {
        key: 'footer_bank',
        title: 'כותרת תחתונה ובנק',
        save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
        allowed_actions: editActions,
        fields: [
            textField('footer_text', 'טקסט כותרת תחתונה', resolved.footer_text, canEdit, 'textarea'),
            textField('bank_name', 'שם בנק', resolved.bank_name, canEdit),
            textField('bank_branch', 'סניף', resolved.bank_branch, canEdit),
            textField('bank_account', 'מספר חשבון', resolved.bank_account, canEdit),
            textField('swift', 'SWIFT', resolved.swift, canEdit),
            textField('iban', 'IBAN', resolved.iban, canEdit),
        ],
    };
    const emailSection = {
        key: 'email_templates',
        title: 'תבניות אימייל',
        save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
        allowed_actions: editActions,
        fields: [
            textField('email_subject_template', 'נושא אימייל', resolved.email_subject_template, canEdit, 'text', '{{document_type}} {{document_number}}'),
            textField('email_body_template', 'גוף אימייל', resolved.email_body_template, canEdit, 'textarea'),
        ],
    };
    const notesSection = {
        key: 'customer_notes_terms',
        title: 'הערות לקוח ותנאים',
        save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
        allowed_actions: editActions,
        fields: [
            textField('customer_notes', 'הערות לקוח (Customer Notes)', resolved.customer_notes, canEdit, 'textarea'),
            textField('terms_and_conditions', 'תנאים והגבלות', resolved.terms_and_conditions, canEdit, 'textarea'),
        ],
    };
    const paymentFields = resolved.payment_methods.map((m) => boolField(`payment_method_${m.key}`, m.label, m.enabled, canEdit));
    const paymentSection = {
        key: 'payment_methods',
        title: 'אמצעי תשלום',
        save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
        allowed_actions: editActions,
        fields: paymentFields,
    };
    return {
        profile_id: row.id,
        title: 'אגדרות מסמך',
        sections: [identitySection, displaySection, footerSection, emailSection, notesSection, paymentSection],
        logo: {
            label: 'לוגו מסמך',
            file_asset_id: row.logo_file_asset_id,
            preview_data_url: resolved.logo_data_url,
            upload_command: INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
            allowed_actions: uploadLogoActions,
            hint: 'PNG, JPEG או WebP — עד 5MB',
        },
        signature: {
            label: 'חתימה',
            file_asset_id: row.signature_file_asset_id,
            preview_data_url: resolved.signature_data_url,
            upload_command: INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
            allowed_actions: uploadSigActions,
            hint: 'PNG, JPEG או WebP — עד 5MB',
        },
        allowed_actions: canEdit
            ? [
                INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
                INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
                INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
            ]
            : [],
    };
}
function parseBooleanBody(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}
export async function updateIncomeDocumentBrandingProfile(scope, body) {
    const section = String(body.section ?? '').trim();
    if (!section)
        throw badRequest('section is required', 'BRANDING_SECTION_REQUIRED');
    const row = await ensureIncomeDocumentBrandingProfile(scope);
    const patch = {};
    if (section === 'identity') {
        patch.company_subtitle = optionalTrimmedString(body.company_subtitle, 500);
        patch.primary_color = normalizeHexColor(body.primary_color, DEFAULT_PRIMARY_COLOR, 'primary_color');
        patch.secondary_color = normalizeHexColor(body.secondary_color, DEFAULT_SECONDARY_COLOR, 'secondary_color');
        patch.table_header_color = normalizeHexColor(body.table_header_color, DEFAULT_PRIMARY_COLOR, 'table_header_color');
        patch.totals_color = normalizeHexColor(body.totals_color, DEFAULT_PRIMARY_COLOR, 'totals_color');
    }
    else if (section === 'display_options') {
        const clientPos = normalizeClientBlockPosition(body.client_block_position);
        const current = parseDisplayOptionsJson(row.display_options, clientPos);
        const next = {
            ...current,
            show_logo: body.show_logo === undefined ? current.show_logo : parseBooleanBody(body.show_logo),
            show_business_address: body.show_business_address === undefined
                ? current.show_business_address
                : parseBooleanBody(body.show_business_address),
            show_business_phone: body.show_business_phone === undefined
                ? current.show_business_phone
                : parseBooleanBody(body.show_business_phone),
            show_business_email: body.show_business_email === undefined
                ? current.show_business_email
                : parseBooleanBody(body.show_business_email),
            show_business_tax_id: body.show_business_tax_id === undefined
                ? current.show_business_tax_id
                : parseBooleanBody(body.show_business_tax_id),
            show_due_date: body.show_due_date === undefined ? current.show_due_date : parseBooleanBody(body.show_due_date),
            show_payment_terms: body.show_payment_terms === undefined
                ? current.show_payment_terms
                : parseBooleanBody(body.show_payment_terms),
            show_signature: body.show_signature === undefined ? current.show_signature : parseBooleanBody(body.show_signature),
            show_footer: body.show_footer === undefined ? current.show_footer : parseBooleanBody(body.show_footer),
            show_bank_details: body.show_bank_details === undefined
                ? current.show_bank_details
                : parseBooleanBody(body.show_bank_details),
            show_notes: body.show_notes === undefined ? current.show_notes : parseBooleanBody(body.show_notes),
            show_item_index: body.show_item_index === undefined ? current.show_item_index : parseBooleanBody(body.show_item_index),
            show_discount_row: body.show_discount_row === undefined
                ? current.show_discount_row
                : parseBooleanBody(body.show_discount_row),
            show_vat_row: body.show_vat_row === undefined ? current.show_vat_row : parseBooleanBody(body.show_vat_row),
            show_currency: body.show_currency === undefined ? current.show_currency : parseBooleanBody(body.show_currency),
            quantity_position: body.quantity_position === 'after_description' ? 'after_description' : current.quantity_position,
            client_block_position: clientPos,
        };
        patch.display_options = serializeDisplayOptionsJson(next);
        patch.client_block_position = clientPos;
    }
    else if (section === 'footer_bank') {
        patch.footer_text = optionalTrimmedString(body.footer_text, 2000);
        patch.bank_name = optionalTrimmedString(body.bank_name, 200);
        patch.bank_branch = optionalTrimmedString(body.bank_branch, 100);
        patch.bank_account = optionalTrimmedString(body.bank_account, 100);
        patch.swift = optionalTrimmedString(body.swift, 50);
        patch.iban = optionalTrimmedString(body.iban, 50);
    }
    else if (section === 'email_templates') {
        patch.email_subject_template = optionalTrimmedString(body.email_subject_template, 500);
        patch.email_body_template = optionalTrimmedString(body.email_body_template, 8000);
    }
    else if (section === 'customer_notes_terms') {
        patch.customer_notes = optionalTrimmedString(body.customer_notes, 4000);
        patch.terms_and_conditions = optionalTrimmedString(body.terms_and_conditions, 8000);
    }
    else if (section === 'payment_methods') {
        const methods = parsePaymentMethodsJson(row.payment_methods);
        const next = methods.map((m) => ({
            ...m,
            enabled: body[`payment_method_${m.key}`] === undefined
                ? m.enabled
                : parseBooleanBody(body[`payment_method_${m.key}`]),
        }));
        patch.payment_methods = serializePaymentMethodsJson(next);
    }
    else {
        throw badRequest(`Unknown branding section: ${section}`, 'BRANDING_SECTION_INVALID');
    }
    const { data, error } = await supabaseAdmin
        .from('income_document_branding_profiles')
        .update(patch)
        .eq('id', row.id)
        .eq('organization_id', scope.org_id)
        .select('*')
        .single();
    throwIfSupabaseError(error, 'updateIncomeDocumentBrandingProfile');
    void writeAudit({
        organizationId: scope.org_id,
        actorUserId: scope.actor_user_id,
        moduleCode: 'income',
        entityType: 'income_document_branding_profile',
        entityId: row.id,
        action: AUDIT_ACTIONS.INCOME_DOCUMENT_BRANDING_UPDATED,
        payload: { section, issuer_business_id: scope.issuer_business_id },
    }).catch(() => { });
    return data;
}
async function uploadBrandingImage(ctx, scope, body, slot) {
    const fileName = String(body.file_name ?? '').trim();
    const fileBase64 = String(body.file_base64 ?? '').trim();
    if (!fileName)
        throw badRequest('file_name is required');
    if (!fileBase64)
        throw badRequest('file_base64 is required');
    const mimeType = String(body.mime_type ?? 'image/png')
        .toLowerCase()
        .split(';')[0]
        .trim();
    if (!BRANDING_IMAGE_MIME.has(mimeType)) {
        throw badRequest('Invalid image type. Allowed: PNG, JPEG, WebP', 'BRANDING_IMAGE_TYPE_INVALID');
    }
    const buf = Buffer.from(fileBase64, 'base64');
    if (buf.length === 0)
        throw badRequest('File is empty');
    if (buf.length > BRANDING_IMAGE_MAX_BYTES) {
        throw badRequest('File too large. Maximum 5MB', 'BRANDING_IMAGE_TOO_LARGE');
    }
    await ensureOrgAssetsBucket();
    const storageKey = `${scope.org_id}/income-branding/${scope.issuer_business_id}/${slot}-${Date.now()}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_ORG_ASSETS).upload(storageKey, buf, {
        contentType: mimeType,
        upsert: false,
    });
    if (uploadError)
        throw badRequest(uploadError.message ?? 'Upload failed', 'BRANDING_UPLOAD_FAILED');
    const { data: fileAsset, error: fileErr } = await supabaseAdmin
        .from('file_assets')
        .insert({
        organization_id: scope.org_id,
        storage_provider: 'supabase',
        storage_bucket: BUCKET_ORG_ASSETS,
        storage_key: storageKey,
        file_name: fileName,
        mime_type: mimeType,
        file_size: buf.length,
        uploaded_by: scope.actor_user_id,
        access_level: 'organization',
    })
        .select('id')
        .single();
    throwIfSupabaseError(fileErr, 'insertBrandingFileAsset');
    const fileId = String(fileAsset.id);
    const fileRow = await validateOrgFileOwnership(ctx, scope.org_id, fileId);
    assertFileAllowedForSettingsImage(fileRow);
    const row = await ensureIncomeDocumentBrandingProfile(scope);
    const patch = slot === 'logo'
        ? { logo_file_asset_id: fileId }
        : { signature_file_asset_id: fileId };
    const { data, error } = await supabaseAdmin
        .from('income_document_branding_profiles')
        .update(patch)
        .eq('id', row.id)
        .eq('organization_id', scope.org_id)
        .select('*')
        .single();
    throwIfSupabaseError(error, 'linkBrandingImage');
    void writeAudit({
        organizationId: scope.org_id,
        actorUserId: scope.actor_user_id,
        moduleCode: 'income',
        entityType: 'income_document_branding_profile',
        entityId: row.id,
        action: slot === 'logo'
            ? AUDIT_ACTIONS.INCOME_DOCUMENT_BRANDING_LOGO_UPLOADED
            : AUDIT_ACTIONS.INCOME_DOCUMENT_BRANDING_SIGNATURE_UPLOADED,
        payload: { file_asset_id: fileId, issuer_business_id: scope.issuer_business_id },
    }).catch(() => { });
    return data;
}
export async function uploadIncomeDocumentLogo(ctx, scope, body) {
    return uploadBrandingImage(ctx, scope, body, 'logo');
}
export async function uploadIncomeDocumentSignature(ctx, scope, body) {
    return uploadBrandingImage(ctx, scope, body, 'signature');
}
