import 'dotenv/config';
import { supabaseAdmin } from '../dist/db/client.js';
import {
  patchOrganizationSettings,
  getOrganizationSettings,
} from '../dist/domains/organization-settings/organization-settings.service.js';

const orgId = process.argv[2] ?? '31e8d298-054d-49c0-86c4-1b9045500f8e';
const country = (process.argv[3] ?? 'IL').toUpperCase();

async function main() {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_user_id')
    .eq('id', orgId)
    .single();
  if (orgErr || !org) {
    throw orgErr ?? new Error(`Organization not found: ${orgId}`);
  }

  const ownerId = String(org.owner_user_id ?? '');
  if (!ownerId) {
    throw new Error(`Organization ${orgId} has no owner_user_id`);
  }

  const ctx = {
    user: { id: ownerId, authUserId: '', email: 'owner@smoke.local', fullName: null, status: 'active' },
    membership: {
      organizationId: orgId,
      userId: ownerId,
      roleId: 'owner-role',
      roleCode: 'owner',
      permissions: ['settings:write', 'access_settings'],
    },
    organizationId: orgId,
  };

  try {
    const updated = await patchOrganizationSettings(ctx, orgId, { country });
    console.log('PATCH_OK');
    console.log('country_configuration:', JSON.stringify(updated.country_configuration ?? null, null, 2));
  } catch (e) {
    console.log('PATCH_FAILED');
    console.log('name:', e?.name);
    console.log('statusCode:', e?.statusCode);
    console.log('code:', e?.code);
    console.log('message:', e?.message);
    console.log('details:', e?.details ?? null);
  }

  const latest = await getOrganizationSettings(ctx, orgId);
  console.log('LATEST country_configuration:', JSON.stringify(latest.country_configuration ?? null, null, 2));
}

main().catch((e) => {
  console.error('SMOKE_FATAL', e);
  process.exit(1);
});

