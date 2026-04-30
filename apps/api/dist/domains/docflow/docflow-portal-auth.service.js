import crypto from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import { unauthorized } from '../../shared/errors.js';
export function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
export function createOpaqueToken() {
    return crypto.randomBytes(32).toString('base64url');
}
export async function resolvePortalSessionByRawToken(rawToken) {
    const tokenHash = sha256Hex(rawToken);
    const { data, error } = await supabaseAdmin
        .from('client_portal_sessions')
        .select('id, org_id, client_id, portal_user_id, status, expires_at')
        .eq('session_token_hash', tokenHash)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw unauthorized('Invalid portal session');
    if (data.status !== 'active')
        throw unauthorized('Portal session is not active');
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
        throw unauthorized('Portal session expired');
    }
    return {
        sessionId: data.id,
        orgId: data.org_id,
        clientId: data.client_id,
        portalUserId: data.portal_user_id,
    };
}
