import { supabaseAdmin } from '../db/client.js';
import { decryptJson, encryptJson } from './field-encryption.js';
function maskSecret(secret) {
    if (!secret)
        return null;
    if (secret.length <= 6)
        return '***';
    return `${secret.slice(0, 3)}***${secret.slice(-2)}`;
}
function asObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
async function getGlobalSettingsBlob() {
    const { data, error } = await supabaseAdmin
        .from('platform_settings')
        .select('setting_value_json')
        .eq('setting_key', 'email_provider_config')
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        return null;
    return asObj(data.setting_value_json);
}
async function getPlatformPublicUrlRaw() {
    const { data, error } = await supabaseAdmin
        .from('platform_settings')
        .select('setting_value_json')
        .eq('setting_key', 'app_public_url')
        .maybeSingle();
    if (error)
        throw error;
    const blob = asObj(data?.setting_value_json);
    const v = typeof blob.value === 'string' ? blob.value.trim() : '';
    return v || null;
}
export async function buildOwnerEmailProviderConfigAggregate() {
    const data = await getGlobalSettingsBlob();
    const appPublicUrl = await getPlatformPublicUrlRaw();
    if (!data) {
        return {
            provider_type: null,
            provider_display_name: null,
            masked_api_key: null,
            from_email: null,
            from_name: null,
            is_configured: false,
            custom_api_config_summary: null,
            app_public_url: appPublicUrl,
            app_public_url_is_configured: Boolean(appPublicUrl),
            allowed_actions: {
                save_email_provider_config: { enabled: true, reason: null },
                save_platform_public_url: { enabled: true, reason: null },
            },
        };
    }
    let apiKey = null;
    if (typeof data.api_key_encrypted === 'string' && data.api_key_encrypted.trim()) {
        try {
            const dec = decryptJson(data.api_key_encrypted);
            apiKey = typeof dec.value === 'string' && dec.value.trim() ? dec.value.trim() : null;
        }
        catch {
            apiKey = null;
        }
    }
    return {
        provider_type: data.provider_type ?? null,
        provider_display_name: typeof data.provider_display_name === 'string' ? data.provider_display_name : null,
        masked_api_key: maskSecret(apiKey),
        from_email: typeof data.from_email === 'string' ? data.from_email : null,
        from_name: typeof data.from_name === 'string' ? data.from_name : null,
        is_configured: data.is_configured === true,
        custom_api_config_summary: String(data.provider_type ?? '') === 'custom_api'
            ? {
                api_endpoint_url: typeof data.api_endpoint_url === 'string' ? data.api_endpoint_url : null,
                http_method: typeof data.http_method === 'string' ? data.http_method : null,
                auth_type: typeof data.auth_type === 'string' ? data.auth_type : null,
                auth_header_name: typeof data.auth_header_name === 'string' ? data.auth_header_name : null,
                recipient_field: typeof data.recipient_field === 'string' ? data.recipient_field : null,
                subject_field: typeof data.subject_field === 'string' ? data.subject_field : null,
                html_body_field: typeof data.html_body_field === 'string' ? data.html_body_field : null,
                text_body_field: typeof data.text_body_field === 'string' ? data.text_body_field : null,
                success_response_path: typeof data.success_response_path === 'string' ? data.success_response_path : null,
                error_response_path: typeof data.error_response_path === 'string' ? data.error_response_path : null,
            }
            : null,
        allowed_actions: {
            save_email_provider_config: { enabled: true, reason: null },
            save_platform_public_url: { enabled: true, reason: null },
        },
        app_public_url: appPublicUrl,
        app_public_url_is_configured: Boolean(appPublicUrl),
    };
}
export async function getOwnerEmailProviderConfigGlobal() {
    const data = await getGlobalSettingsBlob();
    if (!data || data.is_configured !== true)
        return null;
    const providerType = data.provider_type;
    const fromEmail = String(data.from_email ?? '').trim();
    const fromName = String(data.from_name ?? '').trim();
    if (!providerType || !fromEmail || !fromName)
        return null;
    let apiKey = null;
    if (typeof data.api_key_encrypted === 'string' && data.api_key_encrypted.trim()) {
        const dec = decryptJson(data.api_key_encrypted);
        apiKey = typeof dec.value === 'string' && dec.value.trim() ? dec.value.trim() : null;
    }
    let smtpPassword = null;
    if (typeof data.smtp_password_encrypted === 'string' && data.smtp_password_encrypted.trim()) {
        const dec = decryptJson(data.smtp_password_encrypted);
        smtpPassword = typeof dec.value === 'string' && dec.value.trim() ? dec.value.trim() : null;
    }
    return {
        providerType,
        providerDisplayName: typeof data.provider_display_name === 'string' ? data.provider_display_name : null,
        fromEmail,
        fromName,
        apiKey,
        smtp: {
            host: typeof data.smtp_host === 'string' && data.smtp_host.trim() ? data.smtp_host.trim() : null,
            port: typeof data.smtp_port === 'number' ? data.smtp_port : data.smtp_port ? Number(data.smtp_port) : null,
            user: typeof data.smtp_user === 'string' && data.smtp_user.trim() ? data.smtp_user.trim() : null,
            password: smtpPassword,
        },
        customApi: {
            apiEndpointUrl: typeof data.api_endpoint_url === 'string' && data.api_endpoint_url.trim() ? data.api_endpoint_url.trim() : null,
            httpMethod: 'POST',
            authType: data.auth_type === 'bearer_token' || data.auth_type === 'api_key_header'
                ? data.auth_type
                : null,
            authHeaderName: typeof data.auth_header_name === 'string' && data.auth_header_name.trim() ? data.auth_header_name.trim() : null,
            recipientField: typeof data.recipient_field === 'string' && data.recipient_field.trim() ? data.recipient_field.trim() : null,
            subjectField: typeof data.subject_field === 'string' && data.subject_field.trim() ? data.subject_field.trim() : null,
            htmlBodyField: typeof data.html_body_field === 'string' && data.html_body_field.trim() ? data.html_body_field.trim() : null,
            textBodyField: typeof data.text_body_field === 'string' && data.text_body_field.trim() ? data.text_body_field.trim() : null,
            staticHeaders: data.static_headers_json && typeof data.static_headers_json === 'object' && !Array.isArray(data.static_headers_json)
                ? data.static_headers_json
                : {},
            staticPayload: data.static_payload_json && typeof data.static_payload_json === 'object' && !Array.isArray(data.static_payload_json)
                ? data.static_payload_json
                : {},
            successResponsePath: typeof data.success_response_path === 'string' && data.success_response_path.trim() ? data.success_response_path.trim() : null,
            errorResponsePath: typeof data.error_response_path === 'string' && data.error_response_path.trim() ? data.error_response_path.trim() : null,
        },
        isConfigured: true,
    };
}
function rowToResolvedConfig(data) {
    if (data.is_configured !== true)
        return null;
    const providerType = data.provider_type;
    const fromEmail = String(data.from_email ?? '').trim();
    const fromName = String(data.from_name ?? '').trim();
    if (!providerType || !fromEmail || !fromName)
        return null;
    let apiKey = null;
    if (typeof data.api_key_encrypted === 'string' && data.api_key_encrypted.trim()) {
        const dec = decryptJson(data.api_key_encrypted);
        apiKey = typeof dec.value === 'string' && dec.value.trim() ? dec.value.trim() : null;
    }
    let smtpPassword = null;
    if (typeof data.smtp_password_encrypted === 'string' && data.smtp_password_encrypted.trim()) {
        const dec = decryptJson(data.smtp_password_encrypted);
        smtpPassword = typeof dec.value === 'string' && dec.value.trim() ? dec.value.trim() : null;
    }
    return {
        providerType,
        providerDisplayName: typeof data.provider_display_name === 'string' ? data.provider_display_name : null,
        fromEmail,
        fromName,
        apiKey,
        smtp: {
            host: typeof data.smtp_host === 'string' && data.smtp_host.trim() ? data.smtp_host.trim() : null,
            port: typeof data.smtp_port === 'number' ? data.smtp_port : data.smtp_port ? Number(data.smtp_port) : null,
            user: typeof data.smtp_user === 'string' && data.smtp_user.trim() ? data.smtp_user.trim() : null,
            password: smtpPassword,
        },
        customApi: {
            apiEndpointUrl: typeof data.api_endpoint_url === 'string' && data.api_endpoint_url.trim() ? data.api_endpoint_url.trim() : null,
            httpMethod: 'POST',
            authType: data.auth_type === 'bearer_token' || data.auth_type === 'api_key_header'
                ? data.auth_type
                : null,
            authHeaderName: typeof data.auth_header_name === 'string' && data.auth_header_name.trim() ? data.auth_header_name.trim() : null,
            recipientField: typeof data.recipient_field === 'string' && data.recipient_field.trim() ? data.recipient_field.trim() : null,
            subjectField: typeof data.subject_field === 'string' && data.subject_field.trim() ? data.subject_field.trim() : null,
            htmlBodyField: typeof data.html_body_field === 'string' && data.html_body_field.trim() ? data.html_body_field.trim() : null,
            textBodyField: typeof data.text_body_field === 'string' && data.text_body_field.trim() ? data.text_body_field.trim() : null,
            staticHeaders: data.static_headers_json && typeof data.static_headers_json === 'object' && !Array.isArray(data.static_headers_json)
                ? data.static_headers_json
                : {},
            staticPayload: data.static_payload_json && typeof data.static_payload_json === 'object' && !Array.isArray(data.static_payload_json)
                ? data.static_payload_json
                : {},
            successResponsePath: typeof data.success_response_path === 'string' && data.success_response_path.trim() ? data.success_response_path.trim() : null,
            errorResponsePath: typeof data.error_response_path === 'string' && data.error_response_path.trim() ? data.error_response_path.trim() : null,
        },
        isConfigured: true,
    };
}
export async function getOwnerEmailProviderConfigForOrgOverride(orgId) {
    const { data, error } = await supabaseAdmin
        .from('owner_email_provider_configs')
        .select('provider_type, provider_display_name, from_email, from_name, api_key_encrypted, smtp_host, smtp_port, smtp_user, smtp_password_encrypted, is_configured, api_endpoint_url, http_method, auth_type, auth_header_name, recipient_field, subject_field, html_body_field, text_body_field, static_headers_json, static_payload_json, success_response_path, error_response_path')
        .eq('org_id', orgId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        return null;
    return rowToResolvedConfig(data);
}
export async function resolveEmailProvider(orgId) {
    const orgOverride = await getOwnerEmailProviderConfigForOrgOverride(orgId);
    if (orgOverride)
        return orgOverride;
    return getOwnerEmailProviderConfigGlobal();
}
export function encryptOptionalSecret(value) {
    const clean = typeof value === 'string' ? value.trim() : '';
    if (!clean)
        return null;
    return encryptJson({ value: clean });
}
export async function saveOwnerEmailProviderConfigGlobal(payload, actorUserId) {
    const { error } = await supabaseAdmin.from('platform_settings').upsert({
        setting_key: 'email_provider_config',
        setting_value_json: payload,
        updated_by_user_id: actorUserId,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' });
    if (error)
        throw error;
}
export async function savePlatformPublicUrlGlobal(appPublicUrl, actorUserId) {
    const { error } = await supabaseAdmin.from('platform_settings').upsert({
        setting_key: 'app_public_url',
        setting_value_json: { value: appPublicUrl.trim() },
        updated_by_user_id: actorUserId,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' });
    if (error)
        throw error;
}
export async function getPlatformPublicUrlForInvite() {
    const configured = await getPlatformPublicUrlRaw();
    if (configured)
        return configured;
    if ((process.env.NODE_ENV ?? 'development') === 'development') {
        console.warn('[docflow] app_public_url not configured in platform_settings, fallback to http://localhost:3001');
        return 'http://localhost:3001';
    }
    return null;
}
export async function saveOwnerEmailProviderConfigOrgOverride(orgId, payload, actorUserId) {
    const { error } = await supabaseAdmin.from('owner_email_provider_configs').upsert({
        org_id: orgId,
        ...payload,
        updated_by_user_id: actorUserId,
        created_by_user_id: actorUserId,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' });
    if (error)
        throw error;
}
