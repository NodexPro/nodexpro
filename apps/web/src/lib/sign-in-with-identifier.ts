import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH } from '../api/endpoints';
import { apiJsonPublic } from '../api/client';
import { readLoginStamp } from './login-cooldown.pure';

type LoginSessionPayload = {
  session: { access_token: string; refresh_token: string } | null;
};

/** Canonical login through the API so a verified additional email maps to the same user without leaking the primary address. */
export async function signInWithIdentifier(
  supabase: SupabaseClient,
  identifier: string,
  password: string,
): Promise<void> {
  const result = await apiJsonPublic<LoginSessionPayload>(AUTH.login, {
    method: 'POST',
    headers: {
      'x-nodexpro-login-stamp': readLoginStamp(typeof sessionStorage === 'undefined' ? null : sessionStorage),
    },
    body: JSON.stringify({ email: identifier.trim().toLowerCase(), password }),
  });
  if (!result.session?.access_token || !result.session.refresh_token) {
    throw new Error('No session after sign in');
  }
  const { error } = await supabase.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  });
  if (error) throw error;
}
