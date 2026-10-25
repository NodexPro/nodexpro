import { supabaseAdmin } from '../../db/client.js';
import { config } from '../../config.js';
import type { RequestContext } from '../../shared/context.js';
import { writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  decidePermanentMfaActivation,
  isMissingRelationError,
  isRecoveryDrillReady,
  parseActivationRequestId,
  resolveActivationWrite,
} from '../../shared/privileged-mfa-activation.pure.js';
import { isPlatformOwnerSession } from '../../shared/privileged-mfa.pure.js';
import { recordSecurityEvent } from '../../shared/security-event.service.js';
import { buildOwnerSecurityEventsAggregate } from '../owner-system-health/owner-security-events.service.js';
import {
  hasVerifiedTotp,
  loadActivationRow,
  loadLatestRecoveryDrillAt,
  loadUnusedRecoveryCodes,
  refreshPrivilegedMfaGate,
  verifyMfaRecovery,
} from './privileged-mfa.service.js';

export async function activatePlatformOwnerMfa(
  ctx: RequestContext,
  accessToken: string,
  requestIdInput: unknown,
) {
  await refreshPrivilegedMfaGate();
  const owner = isPlatformOwnerSession({
    userEmail: ctx.user.email,
    configuredOwnerEmail: config.platformOwner.email,
    tenantRoleCode: ctx.membership?.roleCode ?? null,
  });
  if (!owner) throw forbidden('Platform owner access required', 'PLATFORM_OWNER_REQUIRED');

  const requestId = parseActivationRequestId(requestIdInput);
  if (!requestId) throw badRequest('activation_request_id is required', 'ACTIVATION_REQUEST_ID_REQUIRED');

  const unused = await loadUnusedRecoveryCodes(ctx.user.id);
  const latestDrillAt = await loadLatestRecoveryDrillAt(ctx.user.id);
  const totpVerified = await hasVerifiedTotp(accessToken);
  const activation = await loadActivationRow();
  const decision = decidePermanentMfaActivation({
    platformOwner: owner,
    alreadyActive: activation.state === 'permanently_active',
    assurance: ctx.authenticatorAssurance ?? 'aal1',
    totpVerified,
    recoveryStorageReady: unused.count > 0 || unused.latestIssuedAt !== null,
    unusedRecoveryCount: unused.count,
    recoveryDrillReady: isRecoveryDrillReady({
      latestIssuedAt: unused.latestIssuedAt,
      latestDrillAt,
      unusedRecoveryCount: unused.count,
    }),
  });

  if (decision.outcome === 'reject') {
    throw new AppError(403, 'לא ניתן להפעיל MFA לצמיתות', decision.code);
  }

  let inserted = false;
  let uniqueViolation = false;
  if (decision.outcome === 'activate') {
    if (!latestDrillAt) {
      throw new AppError(403, 'לא ניתן להפעיל MFA לצמיתות', 'MFA_RECOVERY_DRILL_REQUIRED');
    }
    const activatedAt = new Date().toISOString();
    const written = await supabaseAdmin
      .from('platform_owner_mfa_enforcement')
      .update({
        state: 'PERMANENTLY_ACTIVE',
        activated_at: activatedAt,
        activated_by_user_id: ctx.user.id,
        recovery_verified_at: latestDrillAt,
        activation_request_id: requestId,
      })
      .eq('id', 'platform_owner')
      .eq('state', 'NOT_ACTIVATED')
      .select('id');
    if (written.error) {
      uniqueViolation = written.error.code === '23505' || String(written.error.message ?? '').includes('duplicate');
      if (!uniqueViolation && isMissingRelationError(written.error)) {
        throw new AppError(503, 'מצב ההפעלה אינו זמין', 'MFA_ACTIVATION_UNAVAILABLE');
      }
      if (!uniqueViolation) {
        throw new AppError(503, 'ההפעלה לא נשמרה', 'MFA_ACTIVATION_FAILED');
      }
    } else if (written.data?.length) {
      inserted = true;
      await supabaseAdmin.from('platform_owner_mfa_activation_receipt').insert({
        id: 'platform_owner',
        activated_at: activatedAt,
        activated_by_user_id: ctx.user.id,
        activation_request_id: requestId,
      });
    }
  }

  await refreshPrivilegedMfaGate();
  const persisted = await loadActivationRow();
  const write = resolveActivationWrite({
    inserted,
    uniqueViolation,
    persistedState: persisted.state,
  });
  if (write === 'failed') {
    throw new AppError(503, 'ההפעלה לא נשמרה', 'MFA_ACTIVATION_FAILED');
  }

  if (inserted) {
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'security',
      entityId: ctx.user.id,
      action: 'security.platform_owner_mfa_activated',
      payload: { activation_request_id: requestId },
    });
    await recordSecurityEvent({
      action: 'security.platform_owner_mfa_activated',
      dedupeKey: `mfa-activated:${ctx.user.id}`,
      actorUserId: ctx.user.id,
      payload: { kind: 'platform_owner_mfa_activated' },
    });
  }

  return {
    ...(await buildOwnerSecurityEventsAggregate(ctx, accessToken)),
    activation_result: write,
  };
}

export async function verifyPlatformOwnerMfaRecovery(
  ctx: RequestContext,
  accessToken: string,
  codeInput: unknown,
) {
  await refreshPrivilegedMfaGate();
  await verifyMfaRecovery(ctx, accessToken, codeInput);
  return buildOwnerSecurityEventsAggregate(ctx, accessToken);
}
