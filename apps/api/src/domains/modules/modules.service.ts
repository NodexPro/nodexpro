import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { getDependencyCodes } from './dependency.service.js';

export async function listModules() {
  const { data } = await supabaseAdmin
    .from('modules')
    .select('id, code, name, description, scope_type, country_code, is_active, is_sellable, default_visibility, version, category, schema_version, migration_version')
    .eq('is_active', true)
    .order('code');
  return data ?? [];
}

/** Registry with dependency codes per module. */
export async function listRegistryWithDependencies(): Promise<
  { id: string; code: string; name: string; version: string; category: string | null; scopeType: string; dependencies: string[] }[]
> {
  const rows = await listModules();
  const result = await Promise.all(
    (rows as { id: string; code: string; name: string; version?: string; category?: string; scope_type: string }[]).map(
      async (r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        version: r.version ?? '1.0.0',
        category: r.category ?? null,
        scopeType: r.scope_type,
        dependencies: await getDependencyCodes(r.id),
      })
    )
  );
  return result;
}

export async function listOrganizationModules(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  const { data } = await supabaseAdmin
    .from('organization_modules')
    .select('id, module_id, status, activated_at, modules(id, code, name, description)')
    .eq('organization_id', orgId)
    .order('activated_at', { ascending: false });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'module',
    action: AUDIT_ACTIONS.MODULES_VIEWED,
    payload: {},
  });
  return data ?? [];
}
