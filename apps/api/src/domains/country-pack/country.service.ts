import { supabaseAdmin } from '../../db/client.js';
import { notFound } from '../../shared/errors.js';
import type { Country } from './country-pack.types.js';

/**
 * Internal-only country registry readers.
 * Not for direct frontend/API exposure.
 */
export async function getCountryByCode(code: string): Promise<Country | null> {
  const { data, error } = await supabaseAdmin
    .from('countries')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return (data as Country | null) ?? null;
}

export async function assertCountryExists(code: string): Promise<Country> {
  const country = await getCountryByCode(code);
  if (!country) throw notFound('Country not found');
  return country;
}

