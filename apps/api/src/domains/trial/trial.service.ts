import { supabaseAdmin } from '../../db/client.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { isTrialAlreadyUsed } from './legal-identity.service.js';

const TRIAL_MONTHS = 2;

export interface TrialStateDto {
  hasLegalIdentity: boolean;
  trialStatus: 'none' | 'not_started' | 'trialing' | 'trial_expired' | 'converted' | 'blocked';
  startedAt: string | null;
  endsAt: string | null;
  daysRemaining: number | null;
  trialScope: string;
  legalIdentityMasked: string | null;
  legalIdentityLocked: boolean;
  blocked: boolean;
}

/**
 * Returns whether the org has ever had a full-platform trial that is now expired (ends_at in past).
 */
export async function hasExpiredTrial(organizationId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('organization_trials')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('trial_scope', 'full_platform')
    .or('status.eq.trial_expired,ends_at.lt.' + now)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Returns whether the org has a valid (active) full-platform trial: status trialing and ends_at > now.
 */
export async function hasValidTrial(organizationId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('organization_trials')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('trial_scope', 'full_platform')
    .eq('status', 'trialing')
    .gt('ends_at', now)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Get trial state for API. No legal identity value/hash returned.
 * Lazy expiry: when status is trialing and ends_at has passed, update row to trial_expired and write audit.
 */
export async function getTrialState(organizationId: string): Promise<TrialStateDto> {
  const [identityRes, trialRes] = await Promise.all([
    supabaseAdmin
      .from('organization_legal_identities')
      .select('id, legal_identity_masked, is_locked')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('organization_trials')
      .select('id, status, started_at, ends_at')
      .eq('organization_id', organizationId)
      .eq('trial_scope', 'full_platform')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const identity = identityRes.data;
  const trial = trialRes.data;
  const hasLegalIdentity = !!identity;
  const now = new Date();
  let trialStatus: TrialStateDto['trialStatus'] = !trial ? 'none' : (trial.status as TrialStateDto['trialStatus']);
  let endsAt: string | null = trial?.ends_at ?? null;

  if (trial?.status === 'trialing' && trial.ends_at && new Date(trial.ends_at) < now) {
    trialStatus = 'trial_expired';
    await supabaseAdmin
      .from('organization_trials')
      .update({
        status: 'trial_expired',
        expired_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', trial.id);
    await writeAudit({
      organizationId,
      actorUserId: null,
      entityType: 'trial',
      action: AUDIT_ACTIONS.TRIAL_EXPIRED,
      payload: { reason: 'ends_at_passed' },
    });
  }

  let daysRemaining: number | null = null;
  if (endsAt && trialStatus === 'trialing') {
    const end = new Date(endsAt);
    daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  }

  return {
    hasLegalIdentity,
    trialStatus,
    startedAt: trial?.started_at ?? null,
    endsAt,
    daysRemaining,
    trialScope: 'full_platform',
    legalIdentityMasked: identity?.legal_identity_masked ?? null,
    legalIdentityLocked: !!identity?.is_locked,
    blocked: trial?.status === 'blocked',
  };
}

/**
 * Start full-platform trial for org using given legal identity hash.
 * Idempotent: if org already has trialing trial, returns existing. If hash already used elsewhere, blocks.
 */
export async function startTrial(
  ctx: RequestContext,
  organizationId: string,
  legalIdentityHash: string
): Promise<{ started: boolean; endsAt: string | null; blocked: boolean; message?: string }> {
  const alreadyUsed = await isTrialAlreadyUsed(legalIdentityHash);
  if (alreadyUsed) {
    const { data: existingRow } = await supabaseAdmin
      .from('organization_trials')
      .select('id, status, ends_at, legal_identity_hash')
      .eq('organization_id', organizationId)
      .eq('trial_scope', 'full_platform')
      .maybeSingle();

    if (existingRow && existingRow.legal_identity_hash === legalIdentityHash) {
      return {
        started: existingRow.status === 'trialing',
        endsAt: existingRow.ends_at ?? null,
        blocked: false,
      };
    }

    if (existingRow) {
      await supabaseAdmin
        .from('organization_trials')
        .update({ status: 'blocked', legal_identity_hash: legalIdentityHash, updated_at: new Date().toISOString() })
        .eq('id', existingRow.id);
    } else {
      await supabaseAdmin.from('organization_trials').insert({
        organization_id: organizationId,
        legal_identity_hash: legalIdentityHash,
        trial_scope: 'full_platform',
        status: 'blocked',
        updated_at: new Date().toISOString(),
      });
    }

    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      entityType: 'trial',
      action: AUDIT_ACTIONS.TRIAL_START_BLOCKED,
      payload: { reason: 'duplicate_legal_entity' },
    });

    return { started: false, endsAt: null, blocked: true, message: 'Trial already used for this legal identity' };
  }

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + TRIAL_MONTHS);

  const { data: inserted } = await supabaseAdmin
    .from('organization_trials')
    .upsert(
      {
        organization_id: organizationId,
        legal_identity_hash: legalIdentityHash,
        trial_scope: 'full_platform',
        status: 'trialing',
        started_at: new Date().toISOString(),
        ends_at: endsAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,trial_scope' }
    )
    .select('ends_at')
    .single();

  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    entityType: 'trial',
    action: AUDIT_ACTIONS.TRIAL_STARTED,
    payload: { endsAt: endsAt.toISOString() },
  });

  return {
    started: true,
    endsAt: inserted?.ends_at ?? endsAt.toISOString(),
    blocked: false,
  };
}
