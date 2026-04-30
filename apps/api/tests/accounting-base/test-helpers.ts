import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../src/shared/context.js';
import { supabaseAdmin } from '../../src/db/client.js';

export type TestEnv = {
  marker: string;
  userId: string;
  orgA: string;
  orgB: string;
};

export function makeMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTestEnv(prefix: string): Promise<TestEnv> {
  const marker = makeMarker(prefix);
  const userId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();

  const { error: userErr } = await supabaseAdmin.from('users').insert({
    id: userId,
    email: `${marker}@test.local`,
    status: 'active',
  });
  if (userErr) throw userErr;

  const { error: orgErr } = await supabaseAdmin.from('organizations').insert([
    { id: orgA, name: `${marker}-org-a`, country_code: 'IL', timezone: 'UTC', status: 'active' },
    { id: orgB, name: `${marker}-org-b`, country_code: 'IL', timezone: 'UTC', status: 'active' },
  ]);
  if (orgErr) throw orgErr;

  return { marker, userId, orgA, orgB };
}

export function buildCtx(orgId: string, userId: string, permissions: string[]): RequestContext {
  return {
    user: {
      id: userId,
      authUserId: '',
      email: 'qa@test.local',
      fullName: null,
      status: 'active',
    },
    membership: {
      organizationId: orgId,
      userId,
      roleId: 'qa-role',
      roleCode: 'owner',
      permissions,
    },
    organizationId: orgId,
  };
}

export async function createPeriod(args: {
  id?: string;
  orgId: string;
  label: string;
  status?: 'open' | 'locked' | 'closed';
}): Promise<string> {
  const id = args.id ?? randomUUID();
  const { error } = await supabaseAdmin.from('accounting_periods').insert({
    id,
    organization_id: args.orgId,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    period_label: args.label,
    status: args.status ?? 'open',
    base_currency: 'ILS',
  });
  if (error) throw error;
  return id;
}

export async function createCategory(args: {
  id?: string;
  orgId: string;
  code: string;
  categoryType?: string;
}): Promise<string> {
  const id = args.id ?? randomUUID();
  const { error } = await supabaseAdmin.from('accounting_categories').insert({
    id,
    organization_id: args.orgId,
    code: args.code,
    name: args.code,
    category_type: args.categoryType ?? 'income',
    status: 'active',
    is_system: false,
  });
  if (error) throw error;
  return id;
}

export async function createClient(args: { id?: string; orgId: string; userId: string; displayName: string }): Promise<string> {
  const id = args.id ?? randomUUID();
  const { error } = await supabaseAdmin.from('clients').insert({
    id,
    organization_id: args.orgId,
    tax_id: `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15),
    client_type: 'business_customer',
    display_name: args.displayName,
    created_by: args.userId,
  });
  if (error) throw error;
  return id;
}

export async function cleanupTestEnv(env: TestEnv): Promise<void> {
  const orgIds = [env.orgA, env.orgB];

  await supabaseAdmin.from('accounting_activity_timeline').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('accounting_entry_links').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('accounting_summaries').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('accounting_entries').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('accounting_categories').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('accounting_periods').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('clients').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('file_assets').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('audit_log').delete().in('organization_id', orgIds);
  await supabaseAdmin.from('organizations').delete().in('id', orgIds);
  await supabaseAdmin.from('users').delete().eq('id', env.userId);
}

export const FULL_PERMS = [
  'accounting_base.period.manage',
  'accounting_base.entry.write',
  'accounting_base.category.manage',
  'accounting_base.link.manage',
  'accounting_base.summary.recompute',
  'accounting_base.view',
  'accounting_base.summary.view',
];
