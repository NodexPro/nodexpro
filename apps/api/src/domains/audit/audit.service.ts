import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';

export async function listAudit(ctx: RequestContext, orgId: string, limit = 50, offset = 0) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select('id, organization_id, actor_user_id, module_code, entity_type, entity_id, action, payload_json, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data ?? [];
}
