import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
/**
 * Internal-only country-pack registry readers.
 */
export async function getCountryPack(packId) {
    const { data, error } = await supabaseAdmin
        .from('country_packs')
        .select('*')
        .eq('id', packId)
        .maybeSingle();
    if (error)
        throw error;
    return data ?? null;
}
export async function listCountryPacksByCountry(countryCode) {
    const { data, error } = await supabaseAdmin
        .from('country_packs')
        .select('*')
        .eq('country_code', countryCode)
        .order('created_at', { ascending: false });
    if (error)
        throw error;
    return (data ?? []);
}
export async function assertPackBelongsToCountry(packId, countryCode) {
    const pack = await getCountryPack(packId);
    if (!pack)
        throw notFound('Country pack not found');
    if (pack.country_code !== countryCode) {
        throw notFound('Country pack does not belong to country');
    }
    return pack;
}
