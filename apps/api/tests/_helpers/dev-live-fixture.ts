import { isPermanentDevSupabaseUrl } from '../country-pack/verification-safety.pure.ts';

export const PERMANENT_DEV_REF = 'jgxezhjctrgfbmmkqqhn';
export const ORDINANCE_DOCUMENT_ID = 'd4139c37-f9d7-48f6-a650-dfaeb2fc51ad';
export const ORDINANCE_SOURCE_ID = 'afae0b6c-3a0d-444e-bd38-b44c25e23e52';

type Skipable = { skip: (message?: string) => void };

/**
 * TAX-650: live tests must not write canonical Tax Knowledge / enabled Country Packs
 * into permanent DEV. Those rows cannot be hard-deleted via PostgREST
 * (tax_knowledge_forbid_delete). Use a disposable database, or skip.
 *
 * Trainer-only tests may write documents/jobs on the real ordinance source and
 * must delete those rows in t.after. They must restore Owner workspace selection
 * and must not leave enabled packs.
 */
export function skipCanonicalWritesOnPermanentDev(t: Skipable): boolean {
  if (!isPermanentDevSupabaseUrl(process.env.SUPABASE_URL)) return false;
  t.skip(
    'TAX-650: refuse persistent canonical Tax Knowledge / Country Pack writes on permanent DEV jgxezhjctrgfbmmkqqhn',
  );
  return true;
}

export function requirePermanentDev(label: string): void {
  const url = process.env.SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url.includes(PERMANENT_DEV_REF) || !key) {
    throw new Error(`${label} refuses to run: not DEV Supabase ${PERMANENT_DEV_REF}`);
  }
}
