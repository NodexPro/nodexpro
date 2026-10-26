import { supabaseAdmin } from '../db/client.js';
import { supabaseEmbedOne } from './supabase-embed.js';
import { officeAlertRecipients } from './office-login-alert.pure.js';

export async function listOfficeOwnerEmails(organizationId: string): Promise<string[]> {
  const orgId = organizationId.trim();
  if (!orgId) return [];
  const memberships = await supabaseAdmin
    .from('organization_memberships')
    .select('role_code, users!organization_memberships_user_id_fkey(email)')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .in('role_code', ['owner', 'admin']);
  if (memberships.error) return [];
  type Row = { role_code: string; users: { email: string | null } | { email: string | null }[] | null };
  const rows = (memberships.data ?? []) as unknown as Row[];
  const owners = rows.filter((row) => row.role_code === 'owner');
  const pool = owners.length ? owners : rows;
  const emails = pool
    .map((row) => supabaseEmbedOne(row.users)?.email ?? '')
    .filter(Boolean);
  return officeAlertRecipients(emails);
}
