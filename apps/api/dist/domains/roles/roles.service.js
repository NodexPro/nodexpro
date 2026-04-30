import { supabaseAdmin } from '../../db/client.js';
export async function listRoles() {
    const { data } = await supabaseAdmin.from('roles').select('id, code, name, scope').eq('is_system', true).order('code');
    return data ?? [];
}
