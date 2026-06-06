/**
 * INC-1b — Income workspace issuer context (aggregate + select command).
 * Backend-owned issuer truth; no documents, accounting, work engine, or docflow.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { resolveIncomeIssuerBusinessDisplay } from './income-issuer-display.js';
import { buildAllowedActingModes, buildAllowedActions, buildIssuerOptions, } from './income-workspace-context.builders.js';
import { buildIncomeClientDocumentManagementPanel } from './income-client-document-management-panel.service.js';
import { INCOME_CONTEXT_AGGREGATE_KEY, INCOME_COMMAND_SELECT_ISSUER, INCOME_PERMISSIONS, } from './income.types.js';
import { syncIncomeIssuerProfileFromOrganization } from './income-issuer-profile-sync.service.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value) {
    return UUID_RE.test(value);
}
function reqUuid(value, field) {
    const s = String(value ?? '').trim();
    if (!isUuid(s))
        throw badRequest(`${field} must be a valid UUID`);
    return s;
}
function parseActingMode(value) {
    const mode = String(value ?? '').trim();
    if (mode === 'self' || mode === 'office_representative')
        return mode;
    throw badRequest('acting_mode must be self or office_representative');
}
export function incomeWorkspacePermissionsFromContext(ctx) {
    const perms = ctx.membership?.permissions ?? [];
    return {
        view: hasPermission(perms, INCOME_PERMISSIONS.view),
        edit: hasPermission(perms, INCOME_PERMISSIONS.edit),
        issue: hasPermission(perms, INCOME_PERMISSIONS.issue),
        issue_on_behalf: hasPermission(perms, INCOME_PERMISSIONS.issueOnBehalf),
    };
}
function incomePermissionsFromContext(ctx) {
    return incomeWorkspacePermissionsFromContext(ctx);
}
/** Ensures the tenant-owned issuer profile exists; syncs from Core when missing or stale. */
export async function ensureOrgIncomeIssuerProfile(orgId) {
    const synced = await syncIncomeIssuerProfileFromOrganization(orgId, { audit: false });
    return {
        id: synced.id,
        organization_id: synced.organization_id,
        display_name: synced.display_name,
        legal_name: synced.legal_name,
    };
}
async function loadClientForIssuer(orgId, clientId) {
    const { data } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, legal_name, is_archived')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    return data ?? null;
}
async function listRepresentedClientIssuerOptions(orgId) {
    const { data } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, legal_name, is_archived')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('display_name', { ascending: true })
        .limit(500);
    return (data ?? []);
}
export { resolveIncomeIssuerBusinessDisplay } from './income-issuer-display.js';
export function assertIncomeIssuerContextForCommand(ctx, orgId, input, deps) {
    const perms = incomePermissionsFromContext(ctx);
    if (!perms.view)
        throw forbidden('income.view required');
    if (input.acting_mode === 'self') {
        if (input.represented_client_id != null) {
            throw badRequest('represented_client_id must be null in self mode');
        }
        if (input.issuer_business_id !== deps.orgIssuerProfileId) {
            throw badRequest('issuer_business_id must be the organization issuer profile in self mode');
        }
        return;
    }
    if (!perms.issue_on_behalf) {
        throw forbidden('income.issue_on_behalf required for office_representative mode');
    }
    if (!hasPermission(ctx.membership?.permissions ?? [], 'clients:read')) {
        throw forbidden('clients:read required to represent a client');
    }
    const clientId = input.represented_client_id;
    if (!clientId) {
        throw badRequest('represented_client_id is required in office_representative mode');
    }
    if (input.issuer_business_id !== clientId) {
        throw badRequest('issuer_business_id must equal represented_client_id in office_representative mode');
    }
    if (!deps.representedClient) {
        throw notFound('Represented client not found');
    }
    if (deps.representedClient.is_archived) {
        throw badRequest('Represented client is archived');
    }
}
async function loadPersistedWorkspace(orgId, userId) {
    const { data } = await supabaseAdmin
        .from('income_user_workspace_contexts')
        .select('acting_mode, issuer_business_id, represented_client_id')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
    return data ?? null;
}
async function upsertPersistedWorkspace(orgId, userId, row) {
    const { error } = await supabaseAdmin.from('income_user_workspace_contexts').upsert({
        organization_id: orgId,
        user_id: userId,
        acting_mode: row.acting_mode,
        issuer_business_id: row.issuer_business_id,
        represented_client_id: row.represented_client_id,
    }, { onConflict: 'organization_id,user_id' });
    throwIfSupabaseError(error, 'upsertIncomeUserWorkspaceContext');
}
async function resolveEffectiveWorkspace(orgId, persisted, orgIssuer) {
    const warnings = [];
    const defaultRow = {
        acting_mode: 'self',
        issuer_business_id: orgIssuer.id,
        represented_client_id: null,
    };
    if (!persisted) {
        return { row: defaultRow, warnings };
    }
    if (persisted.acting_mode === 'self') {
        if (persisted.represented_client_id != null || persisted.issuer_business_id !== orgIssuer.id) {
            warnings.push({
                code: 'issuer_context_reset',
                message: 'Stored self issuer context was invalid and was reset to the office issuer.',
            });
            return { row: defaultRow, warnings };
        }
        return { row: persisted, warnings };
    }
    if (!persisted.represented_client_id) {
        warnings.push({
            code: 'issuer_context_reset',
            message: 'Stored office representative context was missing a client and was reset.',
        });
        return { row: defaultRow, warnings };
    }
    const client = await loadClientForIssuer(orgId, persisted.represented_client_id);
    if (!client ||
        client.is_archived ||
        persisted.issuer_business_id !== persisted.represented_client_id) {
        warnings.push({
            code: 'issuer_context_reset',
            message: 'Stored represented client is unavailable; workspace reset to office issuer.',
        });
        return { row: defaultRow, warnings };
    }
    return { row: persisted, warnings };
}
export async function buildIncomeWorkspaceContextAggregate(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    const actorUserId = ctx.user.id;
    const perms = incomePermissionsFromContext(ctx);
    if (!perms.view)
        throw forbidden('income.view required');
    const orgIssuer = await ensureOrgIncomeIssuerProfile(orgId);
    const clients = perms.issue_on_behalf && hasPermission(ctx.membership?.permissions ?? [], 'clients:read')
        ? await listRepresentedClientIssuerOptions(orgId)
        : [];
    const persisted = await loadPersistedWorkspace(orgId, actorUserId);
    const { row: effective, warnings: resetWarnings } = await resolveEffectiveWorkspace(orgId, persisted, orgIssuer);
    if (persisted &&
        (persisted.acting_mode !== effective.acting_mode ||
            persisted.issuer_business_id !== effective.issuer_business_id ||
            persisted.represented_client_id !== effective.represented_client_id)) {
        await upsertPersistedWorkspace(orgId, actorUserId, effective);
    }
    else if (!persisted) {
        await upsertPersistedWorkspace(orgId, actorUserId, effective);
    }
    const representedClient = effective.represented_client_id != null
        ? await loadClientForIssuer(orgId, effective.represented_client_id)
        : null;
    const issuer_label = resolveIncomeIssuerBusinessDisplay({
        acting_mode: effective.acting_mode,
        orgIssuerProfile: orgIssuer,
        client: representedClient,
    });
    const represented_client_label = effective.acting_mode === 'office_representative' && representedClient
        ? resolveIncomeIssuerBusinessDisplay({
            acting_mode: 'office_representative',
            orgIssuerProfile: null,
            client: representedClient,
        })
        : null;
    const warnings = [...resetWarnings];
    if (effective.acting_mode === 'office_representative' && !perms.issue) {
        warnings.push({
            code: 'issue_permission_missing',
            message: 'income.issue is not granted; issuing documents will be blocked until permission is granted.',
        });
    }
    return {
        aggregate_key: INCOME_CONTEXT_AGGREGATE_KEY,
        org_id: orgId,
        actor_user_id: actorUserId,
        acting_mode: effective.acting_mode,
        active_issuer_business_id: effective.issuer_business_id,
        represented_client_id: effective.represented_client_id,
        issuer_label,
        represented_client_label,
        allowed_acting_modes: buildAllowedActingModes(perms),
        issuer_options: buildIssuerOptions(orgIssuer, clients, perms),
        permissions: perms,
        allowed_actions: buildAllowedActions(perms),
        warnings,
        client_document_management_panel: await buildIncomeClientDocumentManagementPanel({
            ctx,
            perms,
        }),
    };
}
export async function applySelectIncomeIssuerContext(ctx, body, auditMeta) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    const perms = incomePermissionsFromContext(ctx);
    if (!perms.edit)
        throw forbidden('income.edit required');
    const command = String(body.command ?? '').trim();
    if (command !== INCOME_COMMAND_SELECT_ISSUER) {
        throw badRequest(`command must be ${INCOME_COMMAND_SELECT_ISSUER}`);
    }
    const acting_mode = parseActingMode(body.acting_mode);
    const issuer_business_id = reqUuid(body.issuer_business_id, 'issuer_business_id');
    const representedRaw = body.represented_client_id;
    const represented_client_id = representedRaw === null || representedRaw === undefined || representedRaw === ''
        ? null
        : reqUuid(representedRaw, 'represented_client_id');
    const orgIssuer = await ensureOrgIncomeIssuerProfile(orgId);
    const representedClient = represented_client_id != null
        ? await loadClientForIssuer(orgId, represented_client_id)
        : null;
    assertIncomeIssuerContextForCommand(ctx, orgId, { acting_mode, issuer_business_id, represented_client_id }, { orgIssuerProfileId: orgIssuer.id, representedClient });
    await upsertPersistedWorkspace(orgId, ctx.user.id, {
        acting_mode,
        issuer_business_id,
        represented_client_id,
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'income',
        entityType: 'income_user_workspace_context',
        entityId: ctx.user.id,
        action: AUDIT_ACTIONS.INCOME_ISSUER_CONTEXT_SELECTED,
        payload: {
            acting_mode,
            issuer_business_id,
            represented_client_id,
            actor_user_id: ctx.user.id,
        },
        ipAddress: auditMeta?.ipAddress ?? null,
        userAgent: auditMeta?.userAgent ?? null,
    });
}
