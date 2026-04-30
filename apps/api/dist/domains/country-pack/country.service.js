import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
/**
 * Internal-only country registry readers.
 * Not for direct frontend/API exposure.
 */
export async function getCountryByCode(code) {
    const { data, error } = await supabaseAdmin
        .from('countries')
        .select('*')
        .eq('code', code)
        .maybeSingle();
    if (error)
        throw error;
    return data ?? null;
}
export async function assertCountryExists(code) {
    const country = await getCountryByCode(code);
    if (!country)
        throw notFound('Country not found');
    return country;
}
