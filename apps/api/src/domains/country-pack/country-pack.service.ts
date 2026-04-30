import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import type { CountryPack } from './country-pack.types.js';

/**
 * Internal-only country-pack registry readers.
 */
export async function getCountryPack(packId: string): Promise<CountryPack | null> {
  const { data, error } = await supabaseAdmin
    .from('country_packs')
    .select('*')
    .eq('id', packId)
    .maybeSingle();
  if (error) throw error;
  return (data as CountryPack | null) ?? null;
}

export async function listCountryPacksByCountry(countryCode: string): Promise<CountryPack[]> {
  const { data, error } = await supabaseAdmin
    .from('country_packs')
    .select('*')
    .eq('country_code', countryCode)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CountryPack[];
}

export async function assertPackBelongsToCountry(packId: string, countryCode: string): Promise<CountryPack> {
  const pack = await getCountryPack(packId);
  if (!pack) throw notFound('Country pack not found');
  if (pack.country_code !== countryCode) {
    throw notFound('Country pack does not belong to country');
  }
  return pack;
}

