import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { assertCountryExists } from './country.service.js';
import { getCountryPack } from './country-pack.service.js';
import { assertNoOverlapRuleset, assertRulesetExists, resolveActiveRulesetByDate } from './ruleset.service.js';
import { assertLegalValueExists, assertNoOverlapLegalValueVersions } from './legal-value.service.js';
import { normalizeLegalValuePayloadJsonInput } from './docflow-communication-owner-payload.js';
import {
  assertOperationalCommunicationLegalValueMetadata,
  validateLegalValueVersionPayload,
} from './operational-communication-owner-payload.js';
import { getOrganizationCountrySettings } from './organization-country.service.js';
import {
  buildOrganizationCountrySettingsAggregate,
  buildOwnerLegalControlPanelAggregate,
} from './country-pack-read-models.service.js';
import { encryptOptionalSecret } from '../../shared/owner-email-provider-config.service.js';
import { saveOwnerEmailProviderConfigGlobal } from '../../shared/owner-email-provider-config.service.js';
import { saveOwnerEmailProviderConfigOrgOverride } from '../../shared/owner-email-provider-config.service.js';
import { savePlatformPublicUrlGlobal } from '../../shared/owner-email-provider-config.service.js';

type CountryPackCommandType =
  | 'create_country'
  | 'create_country_pack'
  | 'enable_country_pack'
  | 'disable_country_pack'
  | 'create_ruleset'
  | 'update_ruleset_metadata'
  | 'activate_ruleset'
  | 'deactivate_ruleset'
  | 'assign_country_pack_to_organization'
  | 'change_active_ruleset_for_organization'
  | 'update_organization_country_settings'
  | 'create_legal_value'
  | 'update_legal_value_metadata'
  | 'create_legal_value_version'
  | 'update_legal_value_version'
  | 'activate_legal_value_version'
  | 'deactivate_legal_value_version'
  | 'update_owner_note'
  | 'update_usage_hint'
  | 'update_module_scope'
  | 'update_module_price'
  | 'update_package_price'
  | 'create_module_plan'
  | 'save_email_provider_config'
  | 'save_platform_public_url'
  | 'save_request_template_definition'
  | 'archive_request_template_definition'
  | 'extend_org_module_trial'
  | 'activate_org_module_access'
  | 'create_pricing_adjustment'
  | 'cancel_pricing_adjustment';

type CountryPackCommand = {
  command: CountryPackCommandType;
  payload: Record<string, unknown>;
};

type CountryPackCommandResponse = {
  ok: true;
  command: CountryPackCommandType;
  refreshed: {
    aggregate_key:
      | 'owner_legal_control_panel_aggregate'
      | 'organization_country_settings_aggregate';
    aggregate: Record<string, unknown>;
  };
};

function commercialControlsContextFromPayload(payload: Record<string, unknown>): Partial<{
  page: number;
  page_size: number;
  search: string | null;
  module_key: string | null;
  entitlement_status: string | null;
  activation_status: string | null;
}> | null {
  const raw = payload.commercial_controls_context;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    page: Number(o.page ?? 1) || 1,
    page_size: Number(o.page_size ?? 20) || 20,
    search: typeof o.search === 'string' ? o.search : null,
    module_key: typeof o.module_key === 'string' ? o.module_key : null,
    entitlement_status: typeof o.entitlement_status === 'string' ? o.entitlement_status : null,
    activation_status: typeof o.activation_status === 'string' ? o.activation_status : null,
  };
}

async function refreshedOwnerLegalControlPanel(ctx: RequestContext, payload?: Record<string, unknown>): Promise<CountryPackCommandResponse['refreshed']> {
  const commercial = payload ? commercialControlsContextFromPayload(payload) : null;
  return {
    aggregate_key: 'owner_legal_control_panel_aggregate',
    aggregate: await buildOwnerLegalControlPanelAggregate(ctx, commercial ? { commercial_controls: commercial } : undefined),
  };
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('Invalid string value');
  const v = value.trim();
  return v.length ? v : null;
}

function asDate(value: unknown, field: string): string {
  const v = asString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw badRequest(`${field} must be YYYY-MM-DD`);
  }
  return v;
}

function asIsoDateTime(value: unknown, field: string): string {
  const v = asString(value, field);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} must be ISO datetime`);
  return d.toISOString();
}

async function resolveModuleByKey(moduleKey: string): Promise<{ id: string; code: string; is_system: boolean }> {
  const { data, error } = await supabaseAdmin.from('modules').select('id, code, is_system').eq('code', moduleKey).single();
  if (error) throw error;
  if (!data) throw notFound('Module not found');
  return { id: String(data.id), code: String(data.code), is_system: Boolean((data as { is_system?: boolean }).is_system) };
}

async function ensureOrgModuleActive(orgId: string, moduleId: string): Promise<void> {
  const { data: existing, error: eErr } = await supabaseAdmin
    .from('organization_modules')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('module_id', moduleId)
    .maybeSingle();
  if (eErr) throw eErr;
  if (existing) {
    if (String((existing as { status?: string }).status ?? '') !== 'active') {
      const { error: uErr } = await supabaseAdmin
        .from('organization_modules')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', (existing as { id: string }).id);
      if (uErr) throw uErr;
    }
    return;
  }
  const { error: iErr } = await supabaseAdmin.from('organization_modules').insert({
    organization_id: orgId,
    module_id: moduleId,
    status: 'active',
  });
  if (iErr) throw iErr;
}

async function resolveDefaultActivePlanId(moduleId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('module_plans')
    .select('id')
    .eq('module_id', moduleId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw badRequest('No active module plan exists for this module');
  return String((data as { id: string }).id);
}

async function handleExtendOrgModuleTrial(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const orgId = asString(payload.org_id, 'org_id');
  const moduleKey = asString(payload.module_key, 'module_key');
  const expiresAtIso = asIsoDateTime(payload.expires_at, 'expires_at');
  const reason = asString(payload.reason, 'reason');
  const mod = await resolveModuleByKey(moduleKey);
  if (mod.is_system) throw badRequest('System modules do not have commercial trials');

  await ensureOrgModuleActive(orgId, mod.id);

  const { data: existing, error: sErr } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id, status, trial_ends_at, ends_at')
    .eq('organization_id', orgId)
    .eq('module_id', mod.id)
    .maybeSingle();
  if (sErr) throw sErr;

  const oldState = existing
    ? { status: String((existing as any).status ?? ''), trial_ends_at: (existing as any).trial_ends_at ?? null, ends_at: (existing as any).ends_at ?? null }
    : null;

  if (existing && String((existing as any).status ?? '') === 'active') {
    throw badRequest('Cannot extend trial for an active subscription');
  }

  if (existing) {
    const { error: uErr } = await supabaseAdmin
      .from('organization_module_subscriptions')
      .update({ status: 'trialing', trial_ends_at: expiresAtIso, updated_at: new Date().toISOString() })
      .eq('id', (existing as any).id);
    if (uErr) throw uErr;
    await audit(ctx, AUDIT_ACTIONS.OWNER_TRIAL_EXTENDED, 'org_module_subscription', String((existing as any).id), {
      org_id: orgId,
      module_key: moduleKey,
      reason,
      old_state: oldState,
      new_state: { status: 'trialing', trial_ends_at: expiresAtIso },
    });
    return { ok: true, command: 'extend_org_module_trial', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
  }

  const planId = await resolveDefaultActivePlanId(mod.id);
  const { data: created, error: cErr } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .insert({
      organization_id: orgId,
      module_id: mod.id,
      module_plan_id: planId,
      status: 'trialing',
      trial_ends_at: expiresAtIso,
    })
    .select('id')
    .single();
  if (cErr) throw cErr;
  await audit(ctx, AUDIT_ACTIONS.OWNER_TRIAL_EXTENDED, 'org_module_subscription', String((created as any).id), {
    org_id: orgId,
    module_key: moduleKey,
    reason,
    old_state: null,
    new_state: { status: 'trialing', trial_ends_at: expiresAtIso },
  });
  return { ok: true, command: 'extend_org_module_trial', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
}

async function handleActivateOrgModuleAccess(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const orgId = asString(payload.org_id, 'org_id');
  const moduleKey = asString(payload.module_key, 'module_key');
  const activeFromIso = asIsoDateTime(payload.active_from, 'active_from');
  const activeUntilRaw = payload.active_until;
  const activeUntilIso = activeUntilRaw ? asIsoDateTime(activeUntilRaw, 'active_until') : null;
  const reason = asString(payload.reason, 'reason');
  const mod = await resolveModuleByKey(moduleKey);
  if (mod.is_system) throw badRequest('System modules do not have commercial activation');

  await ensureOrgModuleActive(orgId, mod.id);

  const { data: existing, error: sErr } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id, status, trial_ends_at, ends_at, module_plan_id')
    .eq('organization_id', orgId)
    .eq('module_id', mod.id)
    .maybeSingle();
  if (sErr) throw sErr;

  const oldState = existing
    ? {
        status: String((existing as any).status ?? ''),
        trial_ends_at: (existing as any).trial_ends_at ?? null,
        ends_at: (existing as any).ends_at ?? null,
      }
    : null;

  if (existing) {
    // MVP rule: paid activation cleanly replaces trial (and cancels it).
    const { error: uErr } = await supabaseAdmin
      .from('organization_module_subscriptions')
      .update({
        status: 'active',
        started_at: activeFromIso,
        ends_at: activeUntilIso,
        trial_ends_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existing as any).id);
    if (uErr) throw uErr;
    await audit(ctx, AUDIT_ACTIONS.OWNER_MODULE_ACCESS_ACTIVATED, 'org_module_subscription', String((existing as any).id), {
      org_id: orgId,
      module_key: moduleKey,
      reason,
      old_state: oldState,
      new_state: { status: 'active', started_at: activeFromIso, ends_at: activeUntilIso, trial_ends_at: null },
    });
    return { ok: true, command: 'activate_org_module_access', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
  }

  const planId = await resolveDefaultActivePlanId(mod.id);
  const { data: created, error: cErr } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .insert({
      organization_id: orgId,
      module_id: mod.id,
      module_plan_id: planId,
      status: 'active',
      started_at: activeFromIso,
      ends_at: activeUntilIso,
      trial_ends_at: null,
    })
    .select('id')
    .single();
  if (cErr) throw cErr;
  await audit(ctx, AUDIT_ACTIONS.OWNER_MODULE_ACCESS_ACTIVATED, 'org_module_subscription', String((created as any).id), {
    org_id: orgId,
    module_key: moduleKey,
    reason,
    old_state: null,
    new_state: { status: 'active', started_at: activeFromIso, ends_at: activeUntilIso, trial_ends_at: null },
  });
  return { ok: true, command: 'activate_org_module_access', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
}

function computeEffectivePrice(base: number, type: string, value: number | null): number {
  if (!Number.isFinite(base)) return base;
  if (type === 'free_access') return 0;
  const v = value ?? 0;
  if (type === 'discount_amount') return Math.max(0, base - v);
  if (type === 'add_amount') return Math.max(0, base + v);
  if (type === 'replace_price') return Math.max(0, v);
  return base;
}

async function handleCreatePricingAdjustment(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const orgId = asString(payload.org_id, 'org_id');
  const moduleKey = asString(payload.module_key, 'module_key');
  const adjustmentType = asString(payload.adjustment_type, 'adjustment_type');
  if (!['discount_amount', 'replace_price', 'add_amount', 'free_access'].includes(adjustmentType)) {
    throw badRequest('Invalid adjustment_type');
  }
  const startDate = asDate(payload.start_date, 'start_date');
  const endDate = asDate(payload.end_date, 'end_date');
  if (new Date(endDate).getTime() < new Date(startDate).getTime()) throw badRequest('end_date must be >= start_date');
  const reason = asString(payload.reason, 'reason');
  const valueRaw = payload.value;
  const value = valueRaw === undefined || valueRaw === null || valueRaw === '' ? null : Number(valueRaw);
  if (adjustmentType !== 'free_access') {
    if (value === null || !Number.isFinite(value) || value < 0) throw badRequest('value must be a non-negative number');
  }

  const mod = await resolveModuleByKey(moduleKey);
  if (mod.is_system) throw badRequest('System modules do not support pricing adjustments');

  // Overlap protection (MVP): reject if any active adjustment overlaps.
  const { data: overlaps, error: oErr } = await supabaseAdmin
    .from('org_module_pricing_adjustments')
    .select('id, effective_from, effective_until')
    .eq('organization_id', orgId)
    .eq('module_id', mod.id)
    .eq('status', 'active')
    .lte('effective_from', endDate)
    .gte('effective_until', startDate)
    .limit(1);
  if (oErr) throw oErr;
  if ((overlaps ?? []).length) throw conflict('Overlapping active pricing adjustment exists');

  const { data: created, error: cErr } = await supabaseAdmin
    .from('org_module_pricing_adjustments')
    .insert({
      organization_id: orgId,
      module_id: mod.id,
      adjustment_type: adjustmentType,
      value_amount: adjustmentType === 'free_access' ? null : value,
      effective_from: startDate,
      effective_until: endDate,
      reason,
      status: 'active',
      created_by_owner_user_id: ctx.user.id,
    })
    .select('id')
    .single();
  if (cErr) throw cErr;

  await audit(ctx, adjustmentType === 'free_access' ? AUDIT_ACTIONS.OWNER_FREE_ACCESS_GRANTED : AUDIT_ACTIONS.OWNER_PRICING_ADJUSTMENT_CREATED, 'org_module_pricing_adjustment', String((created as any).id), {
    org_id: orgId,
    module_key: moduleKey,
    reason,
    new_state: {
      adjustment_type: adjustmentType,
      value_amount: adjustmentType === 'free_access' ? null : value,
      effective_from: startDate,
      effective_until: endDate,
    },
  });

  return { ok: true, command: 'create_pricing_adjustment', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
}

async function handleCancelPricingAdjustment(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const id = asString(payload.pricing_adjustment_id, 'pricing_adjustment_id');
  const reason = asOptionalString(payload.reason) ?? null;
  const { data: row, error: rErr } = await supabaseAdmin
    .from('org_module_pricing_adjustments')
    .select('id, status, organization_id, module_id, adjustment_type, value_amount, effective_from, effective_until')
    .eq('id', id)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!row) throw notFound('Pricing adjustment not found');
  if (String((row as any).status ?? '') !== 'active') {
    return { ok: true, command: 'cancel_pricing_adjustment', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
  }
  const oldState = {
    adjustment_type: String((row as any).adjustment_type ?? ''),
    value_amount: (row as any).value_amount ?? null,
    effective_from: String((row as any).effective_from ?? ''),
    effective_until: String((row as any).effective_until ?? ''),
  };
  const { error: uErr } = await supabaseAdmin
    .from('org_module_pricing_adjustments')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (uErr) throw uErr;
  await audit(ctx, AUDIT_ACTIONS.OWNER_PRICING_ADJUSTMENT_CANCELLED, 'org_module_pricing_adjustment', id, {
    reason,
    old_state: oldState,
    new_state: { status: 'cancelled' },
  });
  return { ok: true, command: 'cancel_pricing_adjustment', refreshed: await refreshedOwnerLegalControlPanel(ctx, payload) };
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityType: string,
  entityId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType,
    entityId,
    action,
    payload,
  });
}

async function getOrganizationCountryCode(organizationId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('country_code')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.country_code) throw notFound('Organization not found');
  return data.country_code as string;
}

async function handleCreateCountry(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const code = asString(payload.code, 'code').toUpperCase();
  const name = asString(payload.name, 'name');
  const status = asString(payload.status ?? 'active', 'status');
  const defaultTimezone = asOptionalString(payload.default_timezone);

  const { data, error } = await supabaseAdmin
    .from('countries')
    .insert({ code, name, status, default_timezone: defaultTimezone })
    .select('*')
    .single();
  if (error) throw error;

  await audit(ctx, AUDIT_ACTIONS.COUNTRY_CREATED, 'country', data.code, { code, status });
  return {
    ok: true,
    command: 'create_country',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleCreateCountryPack(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
  await assertCountryExists(countryCode);

  const insertPayload = {
    country_code: countryCode,
    pack_code: asString(payload.pack_code, 'pack_code'),
    name: asString(payload.name, 'name'),
    status: asString(payload.status ?? 'draft', 'status'),
    module_code: asOptionalString(payload.module_code),
    framework_version: asString(payload.framework_version, 'framework_version'),
    code_version: asString(payload.code_version, 'code_version'),
  };

  const { data, error } = await supabaseAdmin.from('country_packs').insert(insertPayload).select('*').single();
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.COUNTRY_PACK_CREATED, 'country_pack', data.id, { country_code: countryCode, pack_code: data.pack_code });
  return {
    ok: true,
    command: 'create_country_pack',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleEnableDisablePack(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  nextStatus: 'enabled' | 'disabled',
  command: 'enable_country_pack' | 'disable_country_pack',
  auditAction: string
): Promise<CountryPackCommandResponse> {
  const rawPackId = typeof payload.country_pack_id === 'string' ? payload.country_pack_id.trim() : '';
  const rawPackCode = typeof payload.pack_code === 'string' ? payload.pack_code.trim() : '';
  let packId = rawPackId;
  if (!packId) {
    if (!rawPackCode) {
      throw badRequest('country_pack_id or pack_code is required');
    }
    const { data: rows, error } = await supabaseAdmin
      .from('country_packs')
      .select('id')
      .eq('pack_code', rawPackCode);
    if (error) throw error;
    if (!rows?.length) throw notFound('Country pack not found');
    if (rows.length > 1) {
      throw badRequest('pack_code matches multiple country packs; specify country_pack_id');
    }
    packId = String(rows[0].id);
  }
  const pack = await getCountryPack(packId);
  if (!pack) throw notFound('Country pack not found');
  const { error } = await supabaseAdmin.from('country_packs').update({ status: nextStatus }).eq('id', packId);
  if (error) throw error;
  await audit(ctx, auditAction, 'country_pack', packId, { previous_status: pack.status, status: nextStatus });
  return {
    ok: true,
    command,
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function resolveCountryPackIdForCreateRuleset(payload: Record<string, unknown>): Promise<string> {
  const idRaw = payload.country_pack_id;
  const hasId = typeof idRaw === 'string' && idRaw.trim() !== '';
  if (hasId) {
    return asString(idRaw, 'country_pack_id');
  }

  const codeRaw = payload.pack_code;
  if (typeof codeRaw !== 'string' || !codeRaw.trim()) {
    throw badRequest('country_pack_id or pack_code is required');
  }
  const packCode = codeRaw.trim();

  const { data: rows, error } = await supabaseAdmin.from('country_packs').select('id').eq('pack_code', packCode);
  if (error) throw error;
  if (!rows?.length) throw notFound('Country pack not found');
  if (rows.length > 1) {
    throw badRequest('pack_code matches multiple country packs; specify country_pack_id');
  }
  return rows[0].id as string;
}

async function handleCreateRuleset(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const countryPackId = await resolveCountryPackIdForCreateRuleset(payload);
  await getCountryPack(countryPackId).then((p) => {
    if (!p) throw notFound('Country pack not found');
  });
  const effectiveFrom = asDate(payload.effective_from, 'effective_from');
  const effectiveTo = asOptionalString(payload.effective_to);
  await assertNoOverlapRuleset({ countryPackId, effectiveFrom, effectiveTo });
  const { data, error } = await supabaseAdmin
    .from('country_pack_rulesets')
    .insert({
      country_pack_id: countryPackId,
      ruleset_code: asString(payload.ruleset_code, 'ruleset_code'),
      ruleset_version: asString(payload.ruleset_version, 'ruleset_version'),
      legal_basis_reference: asOptionalString(payload.legal_basis_reference),
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      status: asString(payload.status ?? 'draft', 'status'),
      checksum: asOptionalString(payload.checksum),
    })
    .select('*')
    .single();
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.RULESET_CREATED, 'country_pack_ruleset', data.id, { country_pack_id: countryPackId });
  return {
    ok: true,
    command: 'create_ruleset',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleUpdateRulesetMetadata(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const rulesetId = asString(payload.ruleset_id, 'ruleset_id');
  await assertRulesetExists(rulesetId);
  const patch: Record<string, unknown> = {};
  if (payload.legal_basis_reference !== undefined) patch.legal_basis_reference = asOptionalString(payload.legal_basis_reference);
  if (payload.checksum !== undefined) patch.checksum = asOptionalString(payload.checksum);
  if (payload.ruleset_code !== undefined) patch.ruleset_code = asString(payload.ruleset_code, 'ruleset_code');
  if (payload.ruleset_version !== undefined) patch.ruleset_version = asString(payload.ruleset_version, 'ruleset_version');
  const { error } = await supabaseAdmin.from('country_pack_rulesets').update(patch).eq('id', rulesetId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.RULESET_METADATA_UPDATED, 'country_pack_ruleset', rulesetId, { fields: Object.keys(patch) });
  return {
    ok: true,
    command: 'update_ruleset_metadata',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleActivateDeactivateRuleset(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  status: 'active' | 'disabled',
  command: 'activate_ruleset' | 'deactivate_ruleset',
  action: string
): Promise<CountryPackCommandResponse> {
  const rulesetId = asString(payload.ruleset_id, 'ruleset_id');
  const ruleset = await assertRulesetExists(rulesetId);
  if (status === 'active') {
    await assertNoOverlapRuleset({
      countryPackId: ruleset.country_pack_id,
      effectiveFrom: ruleset.effective_from,
      effectiveTo: ruleset.effective_to,
      excludeRulesetId: ruleset.id,
    });
  }
  const { error } = await supabaseAdmin.from('country_pack_rulesets').update({ status }).eq('id', rulesetId);
  if (error) throw error;
  await audit(ctx, action, 'country_pack_ruleset', rulesetId, { previous_status: ruleset.status, status });
  return {
    ok: true,
    command,
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function upsertOrganizationCountrySettings(input: {
  organizationId: string;
  countryCode: string;
  activeCountryPackId: string | null;
  activeRulesetId: string | null;
  settingsStatus: string;
}): Promise<void> {
  const existing = await getOrganizationCountrySettings(input.organizationId);
  if (!existing) {
    const { error } = await supabaseAdmin.from('organization_country_settings').insert({
      organization_id: input.organizationId,
      country_code: input.countryCode,
      active_country_pack_id: input.activeCountryPackId,
      active_ruleset_id: input.activeRulesetId,
      settings_status: input.settingsStatus,
    });
    if (error) throw error;
    return;
  }
  const { error } = await supabaseAdmin
    .from('organization_country_settings')
    .update({
      country_code: input.countryCode,
      active_country_pack_id: input.activeCountryPackId,
      active_ruleset_id: input.activeRulesetId,
      settings_status: input.settingsStatus,
    })
    .eq('organization_id', input.organizationId);
  if (error) throw error;
}

async function handleAssignCountryPack(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const organizationId = asString(payload.organization_id, 'organization_id');
  const countryPackId = asString(payload.country_pack_id, 'country_pack_id');
  const effectiveDate = asDate(payload.effective_date ?? new Date().toISOString().slice(0, 10), 'effective_date');
  const orgCountryCode = (await getOrganizationCountryCode(organizationId)).toUpperCase();
  const pack = await getCountryPack(countryPackId);
  if (!pack) throw notFound('Country pack not found');
  if (pack.country_code.toUpperCase() !== orgCountryCode) throw conflict('Organization country is not eligible for this pack');
  if (pack.status !== 'enabled') throw conflict('Disabled pack cannot be assigned');
  const resolvedRuleset = await resolveActiveRulesetByDate(countryPackId, effectiveDate);
  if (!resolvedRuleset) {
    throw conflict('Cannot assign country pack without active ruleset for effective date');
  }
  await upsertOrganizationCountrySettings({
    organizationId,
    countryCode: orgCountryCode,
    activeCountryPackId: countryPackId,
    activeRulesetId: resolvedRuleset.id,
    settingsStatus: 'active',
  });
  await audit(ctx, AUDIT_ACTIONS.ORGANIZATION_COUNTRY_PACK_ASSIGNED, 'organization_country_settings', organizationId, {
    organization_id: organizationId,
    country_pack_id: countryPackId,
    ruleset_id: resolvedRuleset.id,
    effective_date: effectiveDate,
  });
  return {
    ok: true,
    command: 'assign_country_pack_to_organization',
    refreshed: {
      aggregate_key: 'organization_country_settings_aggregate',
      aggregate: await buildOrganizationCountrySettingsAggregate(ctx, organizationId),
    },
  };
}

async function handleChangeActiveRulesetForOrganization(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  const organizationId = asString(payload.organization_id, 'organization_id');
  const rulesetId = asString(payload.ruleset_id, 'ruleset_id');
  const settings = await getOrganizationCountrySettings(organizationId);
  if (!settings) throw notFound('Organization country settings not found');
  const ruleset = await assertRulesetExists(rulesetId);
  if (!settings.active_country_pack_id || ruleset.country_pack_id !== settings.active_country_pack_id) {
    throw conflict('Ruleset must belong to organization active country pack');
  }
  await upsertOrganizationCountrySettings({
    organizationId,
    countryCode: settings.country_code,
    activeCountryPackId: settings.active_country_pack_id,
    activeRulesetId: rulesetId,
    settingsStatus: settings.settings_status,
  });
  await audit(ctx, AUDIT_ACTIONS.ACTIVE_RULESET_CHANGED, 'organization_country_settings', organizationId, {
    ruleset_id: rulesetId,
  });
  return {
    ok: true,
    command: 'change_active_ruleset_for_organization',
    refreshed: {
      aggregate_key: 'organization_country_settings_aggregate',
      aggregate: await buildOrganizationCountrySettingsAggregate(ctx, organizationId),
    },
  };
}

async function handleUpdateOrganizationCountrySettings(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  const organizationId = asString(payload.organization_id, 'organization_id');
  const settings = await getOrganizationCountrySettings(organizationId);
  if (!settings) throw notFound('Organization country settings not found');
  const nextStatus = asString(payload.settings_status, 'settings_status');
  await upsertOrganizationCountrySettings({
    organizationId,
    countryCode: settings.country_code,
    activeCountryPackId: settings.active_country_pack_id,
    activeRulesetId: settings.active_ruleset_id,
    settingsStatus: nextStatus,
  });
  await audit(ctx, AUDIT_ACTIONS.ORGANIZATION_COUNTRY_SETTINGS_UPDATED, 'organization_country_settings', organizationId, {
    previous_status: settings.settings_status,
    settings_status: nextStatus,
  });
  return {
    ok: true,
    command: 'update_organization_country_settings',
    refreshed: {
      aggregate_key: 'organization_country_settings_aggregate',
      aggregate: await buildOrganizationCountrySettingsAggregate(ctx, organizationId),
    },
  };
}

async function handleCreateLegalValue(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
  await assertCountryExists(countryCode);
  const category = asString(payload.category, 'category');
  const moduleScope = asString(payload.module_scope, 'module_scope');
  const valueType = asString(payload.value_type, 'value_type');
  const valueKey = asString(payload.value_key, 'value_key');
  assertOperationalCommunicationLegalValueMetadata({
    category,
    module_scope: moduleScope,
    value_type: valueType,
    value_key: valueKey,
  });
  const { data, error } = await supabaseAdmin
    .from('country_legal_values')
    .insert({
      country_code: countryCode,
      value_key: valueKey,
      label: asString(payload.label, 'label'),
      category,
      module_scope: moduleScope,
      usage_hint: asOptionalString(payload.usage_hint),
      owner_note: asOptionalString(payload.owner_note),
      value_type: valueType,
      status: asString(payload.status ?? 'draft', 'status'),
    })
    .select('*')
    .single();
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_CREATED, 'country_legal_value', data.id, {
    country_code: countryCode,
    value_key: data.value_key,
  });
  return {
    ok: true,
    command: 'create_legal_value',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleUpdateLegalValueMetadata(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
  const valueKey = asString(payload.value_key, 'value_key');
  const legalValue = await assertLegalValueExists(countryCode, valueKey);
  const patch: Record<string, unknown> = {};
  if (payload.label !== undefined) patch.label = asString(payload.label, 'label');
  if (payload.category !== undefined) patch.category = asString(payload.category, 'category');
  if (payload.value_type !== undefined) patch.value_type = asString(payload.value_type, 'value_type');
  if (payload.status !== undefined) patch.status = asString(payload.status, 'status');
  if (payload.usage_hint !== undefined) patch.usage_hint = asOptionalString(payload.usage_hint);
  if (payload.owner_note !== undefined) patch.owner_note = asOptionalString(payload.owner_note);
  if (payload.module_scope !== undefined) patch.module_scope = asString(payload.module_scope, 'module_scope');
  const { error } = await supabaseAdmin.from('country_legal_values').update(patch).eq('id', legalValue.id);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_METADATA_UPDATED, 'country_legal_value', legalValue.id, { fields: Object.keys(patch) });
  return {
    ok: true,
    command: 'update_legal_value_metadata',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function resolveRulesetIdForCreateLegalValueVersion(
  payload: Record<string, unknown>,
  countryCode: string
): Promise<string> {
  const idRaw = payload.country_pack_ruleset_id;
  const hasRulesetId = typeof idRaw === 'string' && idRaw.trim() !== '';
  if (hasRulesetId) {
    return asString(idRaw, 'country_pack_ruleset_id');
  }

  const codeRaw = payload.ruleset_code;
  if (typeof codeRaw !== 'string' || !codeRaw.trim()) {
    throw badRequest('country_pack_ruleset_id or ruleset_code is required');
  }
  const rulesetCode = codeRaw.trim();

  const { data: rows, error } = await supabaseAdmin
    .from('country_pack_rulesets')
    .select('id, country_pack_id, country_packs!inner(country_code)')
    .eq('ruleset_code', rulesetCode)
    .eq('country_packs.country_code', countryCode);
  if (error) throw error;
  if (!rows?.length) throw notFound('Ruleset not found for country_code + ruleset_code');
  if (rows.length > 1) {
    throw badRequest('ruleset_code matches multiple rulesets for this country; specify country_pack_ruleset_id');
  }
  return rows[0].id as string;
}

async function handleCreateLegalValueVersion(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
  const valueKey = asString(payload.value_key, 'value_key');
  const rulesetId = await resolveRulesetIdForCreateLegalValueVersion(payload, countryCode);
  const legalValue = await assertLegalValueExists(countryCode, valueKey);
  const ruleset = await assertRulesetExists(rulesetId);
  const pack = await getCountryPack(ruleset.country_pack_id);
  if (!pack || pack.country_code !== countryCode) {
    throw conflict('legal_value_version must match country/ruleset scope');
  }
  const effectiveFrom = asDate(payload.effective_from, 'effective_from');
  const effectiveTo = asOptionalString(payload.effective_to);
  await assertNoOverlapLegalValueVersions({ legalValueId: legalValue.id, effectiveFrom, effectiveTo });
  assertOperationalCommunicationLegalValueMetadata({
    category: legalValue.category,
    module_scope: legalValue.module_scope,
    value_type: legalValue.value_type,
    value_key: legalValue.value_key,
    value_payload_json: payload.value_payload_json,
  });
  const valuePayloadJson = validateLegalValueVersionPayload(payload.value_payload_json);
  if (valuePayloadJson === null || valuePayloadJson === undefined) {
    throw badRequest('value_payload_json is required');
  }
  const { data, error } = await supabaseAdmin
    .from('country_legal_value_versions')
    .insert({
      legal_value_id: legalValue.id,
      country_pack_ruleset_id: rulesetId,
      value_payload_json: valuePayloadJson,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      status: asString(payload.status ?? 'draft', 'status'),
    })
    .select('*')
    .single();
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_CREATED, 'country_legal_value_version', data.id, {
    legal_value_id: legalValue.id,
    ruleset_id: rulesetId,
  });
  return {
    ok: true,
    command: 'create_legal_value_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleUpdateLegalValueVersion(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const versionId = asString(payload.legal_value_version_id, 'legal_value_version_id');
  const { data: current, error: currentError } = await supabaseAdmin
    .from('country_legal_value_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw notFound('Legal value version not found');
  const patch: Record<string, unknown> = {};
  const effectiveFrom = payload.effective_from ? asDate(payload.effective_from, 'effective_from') : current.effective_from;
  const effectiveTo = payload.effective_to !== undefined ? asOptionalString(payload.effective_to) : current.effective_to;
  await assertNoOverlapLegalValueVersions({
    legalValueId: current.legal_value_id,
    effectiveFrom,
    effectiveTo,
    excludeVersionId: versionId,
  });
  if (payload.value_payload_json !== undefined) {
    const { data: lvRow } = await supabaseAdmin
      .from('country_legal_values')
      .select('category, module_scope, value_type, value_key')
      .eq('id', current.legal_value_id)
      .maybeSingle();
    if (lvRow) {
      assertOperationalCommunicationLegalValueMetadata({
        category: String(lvRow.category),
        module_scope: String(lvRow.module_scope),
        value_type: String(lvRow.value_type),
        value_key: String(lvRow.value_key),
        value_payload_json: payload.value_payload_json,
      });
    }
    patch.value_payload_json = validateLegalValueVersionPayload(payload.value_payload_json);
  }
  if (payload.effective_from !== undefined) patch.effective_from = effectiveFrom;
  if (payload.effective_to !== undefined) patch.effective_to = effectiveTo;
  if (payload.status !== undefined) patch.status = asString(payload.status, 'status');
  if (payload.country_pack_ruleset_id !== undefined) {
    const rulesetId = asString(payload.country_pack_ruleset_id, 'country_pack_ruleset_id');
    await assertRulesetExists(rulesetId);
    patch.country_pack_ruleset_id = rulesetId;
  }
  const { error } = await supabaseAdmin.from('country_legal_value_versions').update(patch).eq('id', versionId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.LEGAL_VALUE_VERSION_UPDATED, 'country_legal_value_version', versionId, { fields: Object.keys(patch) });
  return {
    ok: true,
    command: 'update_legal_value_version',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleActivateDeactivateLegalValueVersion(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  status: 'active' | 'disabled',
  command: 'activate_legal_value_version' | 'deactivate_legal_value_version',
  action: string
): Promise<CountryPackCommandResponse> {
  const versionId = asString(payload.legal_value_version_id, 'legal_value_version_id');
  const { data: current, error: currentError } = await supabaseAdmin
    .from('country_legal_value_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw notFound('Legal value version not found');
  if (status === 'active') {
    await assertNoOverlapLegalValueVersions({
      legalValueId: current.legal_value_id,
      effectiveFrom: current.effective_from,
      effectiveTo: current.effective_to,
      excludeVersionId: versionId,
    });
  }
  const { error } = await supabaseAdmin.from('country_legal_value_versions').update({ status }).eq('id', versionId);
  if (error) throw error;
  await audit(ctx, action, 'country_legal_value_version', versionId, { previous_status: current.status, status });
  return {
    ok: true,
    command,
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function updateLegalValueMetadataField(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  field: 'owner_note' | 'usage_hint' | 'module_scope',
  action: string,
  command: 'update_owner_note' | 'update_usage_hint' | 'update_module_scope'
): Promise<CountryPackCommandResponse> {
  const countryCode = asString(payload.country_code, 'country_code').toUpperCase();
  const valueKey = asString(payload.value_key, 'value_key');
  const legalValue = await assertLegalValueExists(countryCode, valueKey);
  const value = field === 'module_scope' ? asString(payload[field], field) : asOptionalString(payload[field]);
  const { error } = await supabaseAdmin.from('country_legal_values').update({ [field]: value }).eq('id', legalValue.id);
  if (error) throw error;
  await audit(ctx, action, 'country_legal_value', legalValue.id, { field });
  return {
    ok: true,
    command,
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

function parseModulePlanLimitsFromPayload(payload: Record<string, unknown>): Array<{
  limit_code: string;
  limit_value: number | null;
  is_unlimited: boolean;
}> {
  const raw = payload.limits_json ?? payload.limits;
  if (raw === undefined || raw === null) return [];
  let parsed: unknown;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      parsed = JSON.parse(s) as unknown;
    } catch {
      throw badRequest('limits_json must be valid JSON');
    }
  } else {
    parsed = raw;
  }
  if (!Array.isArray(parsed)) throw badRequest('limits_json must be a JSON array');
  const out: Array<{ limit_code: string; limit_value: number | null; is_unlimited: boolean }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw badRequest('Invalid limit entry');
    const rec = item as Record<string, unknown>;
    const limit_code = asString(rec.limit_code, 'limit_code');
    const is_unlimited = typeof rec.is_unlimited === 'boolean' ? rec.is_unlimited : false;
    let limit_value: number | null = null;
    const lv = rec.limit_value;
    if (lv !== undefined && lv !== null) {
      const n = typeof lv === 'number' ? lv : Number(lv);
      if (!Number.isFinite(n)) throw badRequest('Invalid limit_value');
      limit_value = n;
    }
    if (!is_unlimited && limit_value === null) {
      throw badRequest(`limit_value is required for limit_code ${limit_code} when is_unlimited is false`);
    }
    out.push({ limit_code, limit_value: is_unlimited ? null : limit_value, is_unlimited });
  }
  return out;
}

async function resolveModuleForNewPlan(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<{ moduleId: string; createdNewModule: boolean; moduleCode: string }> {
  const hasModuleId = Boolean(asOptionalString(payload.module_id));
  const hasModuleCode = Boolean(asOptionalString(payload.module_code));
  const newCode = asOptionalString(payload.new_module_code);
  const newName = asOptionalString(payload.new_module_name);
  const hasNewPair = Boolean(newCode) || Boolean(newName);

  if (hasNewPair && (!newCode || !newName)) {
    throw badRequest('new_module_code and new_module_name are both required to add a new catalog module');
  }

  const modes = [hasModuleId, hasModuleCode, hasNewPair].filter(Boolean).length;
  if (modes !== 1) {
    throw badRequest('Specify exactly one of: module_id, module_code, or new_module_code + new_module_name');
  }

  if (hasModuleId) {
    const id = asString(payload.module_id, 'module_id');
    const { data, error } = await supabaseAdmin.from('modules').select('id, code').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Module not found');
    return { moduleId: data.id, createdNewModule: false, moduleCode: data.code as string };
  }

  if (hasModuleCode) {
    const code = asString(payload.module_code, 'module_code').trim().toLowerCase();
    const { data, error } = await supabaseAdmin.from('modules').select('id, code').eq('code', code).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Module not found');
    return { moduleId: data.id, createdNewModule: false, moduleCode: data.code as string };
  }

  const code = newCode!.trim().toLowerCase();
  const { data: existing, error: exErr } = await supabaseAdmin.from('modules').select('id, code').eq('code', code).maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    return { moduleId: existing.id, createdNewModule: false, moduleCode: existing.code as string };
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('modules')
    .insert({
      code,
      name: newName!.trim(),
      is_system: false,
      is_sellable: true,
      is_active: true,
      scope_type: 'global',
      default_visibility: 'hidden',
    })
    .select('id, code')
    .single();
  if (insErr) throw insErr;
  await audit(ctx, AUDIT_ACTIONS.MODULE_REGISTERED, 'module', inserted.id, {
    source: 'owner_create_module_plan',
    code: inserted.code,
    name: newName!.trim(),
  });
  return { moduleId: inserted.id, createdNewModule: true, moduleCode: inserted.code as string };
}

async function handleCreateModulePlan(ctx: RequestContext, payload: Record<string, unknown>): Promise<CountryPackCommandResponse> {
  const { moduleId, createdNewModule, moduleCode } = await resolveModuleForNewPlan(ctx, payload);

  const planCode = asString(payload.plan_code, 'plan_code').trim();
  const planName = asString(payload.name, 'name').trim();
  if (!planCode) throw badRequest('plan_code is required');
  if (!planName) throw badRequest('name is required');

  const rawPrice = payload.price_amount;
  if (rawPrice === undefined || rawPrice === null) throw badRequest('price_amount is required');
  const priceNum = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(priceNum) || priceNum < 0) throw badRequest('Invalid price_amount');

  const currency = asString(payload.currency, 'currency').toUpperCase();
  if (currency.length !== 3) throw badRequest('currency must be a 3-letter code');

  let billing_period = 'month';
  if (payload.billing_period !== undefined && payload.billing_period !== null) {
    const bp = asString(payload.billing_period, 'billing_period').toLowerCase();
    if (bp !== 'month' && bp !== 'year') throw badRequest("billing_period must be 'month' or 'year'");
    billing_period = bp;
  }

  let sort_order = 0;
  if (payload.sort_order !== undefined && payload.sort_order !== null) {
    const so = typeof payload.sort_order === 'number' ? payload.sort_order : Number(payload.sort_order);
    if (!Number.isFinite(so) || !Number.isInteger(so)) throw badRequest('sort_order must be an integer');
    sort_order = so;
  }

  let is_active = true;
  if (typeof payload.is_active === 'boolean') {
    is_active = payload.is_active;
  }

  const limits = parseModulePlanLimitsFromPayload(payload);

  const { data: dup, error: dupErr } = await supabaseAdmin
    .from('module_plans')
    .select('id')
    .eq('module_id', moduleId)
    .eq('code', planCode)
    .maybeSingle();
  if (dupErr) throw dupErr;
  if (dup) throw conflict('A plan with this code already exists for the module');

  const { data: plan, error: planErr } = await supabaseAdmin
    .from('module_plans')
    .insert({
      module_id: moduleId,
      code: planCode,
      name: planName,
      billing_period,
      currency,
      price_amount: priceNum,
      is_active,
      sort_order,
    })
    .select('id')
    .single();
  if (planErr) throw planErr;

  if (limits.length) {
    const { error: limErr } = await supabaseAdmin.from('module_plan_limits').insert(
      limits.map((l) => ({
        module_plan_id: plan.id,
        limit_code: l.limit_code,
        limit_value: l.limit_value,
        is_unlimited: l.is_unlimited,
      }))
    );
    if (limErr) throw limErr;
  }

  await audit(ctx, AUDIT_ACTIONS.MODULE_PLAN_CREATED, 'module_plan', plan.id, {
    module_id: moduleId,
    module_code: moduleCode,
    plan_code: planCode,
    created_new_module: createdNewModule,
    price_amount: priceNum,
    currency,
    billing_period,
    limits_count: limits.length,
  });

  return {
    ok: true,
    command: 'create_module_plan',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleSaveEmailProviderConfig(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  function parseOptionalObject(v: unknown, field: string): Record<string, unknown> | null {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        return parsed as Record<string, unknown>;
      } catch {
        throw badRequest(`${field} must be a JSON object`);
      }
    }
    if (typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${field} must be an object`);
    return v as Record<string, unknown>;
  }
  const configScope = asOptionalString(payload.config_scope) ?? 'platform_default';
  const organizationIdForOverride = asOptionalString(payload.organization_id);
  if (!['platform_default', 'organization_override'].includes(configScope)) {
    throw badRequest('config_scope must be platform_default | organization_override');
  }
  if (configScope === 'organization_override' && !organizationIdForOverride) {
    throw badRequest('organization_id is required for organization_override scope');
  }
  const providerType = asString(payload.provider_type, 'provider_type') as 'resend' | 'sendgrid' | 'smtp' | 'custom_api';
  if (!['resend', 'sendgrid', 'smtp', 'custom_api'].includes(providerType)) {
    throw badRequest('provider_type must be resend | sendgrid | smtp | custom_api');
  }
  const providerDisplayName = asOptionalString(payload.provider_display_name);
  const fromEmail = asString(payload.from_email, 'from_email');
  const fromName = asString(payload.from_name, 'from_name');
  const apiKey = asOptionalString(payload.api_key);
  const smtpConfigRaw = payload.smtp_config;
  const smtpConfig =
    smtpConfigRaw && typeof smtpConfigRaw === 'object' && !Array.isArray(smtpConfigRaw)
      ? (smtpConfigRaw as Record<string, unknown>)
      : null;
  const smtpHost = asOptionalString(smtpConfig?.host);
  const smtpPortRaw = smtpConfig?.port;
  const smtpPort =
    smtpPortRaw === undefined || smtpPortRaw === null || smtpPortRaw === ''
      ? null
      : Number(smtpPortRaw);
  if (smtpPort !== null && !Number.isFinite(smtpPort)) throw badRequest('smtp_config.port must be a number');
  const smtpUser = asOptionalString(smtpConfig?.user);
  const smtpPassword = asOptionalString(smtpConfig?.password);
  const apiEndpointUrl = asOptionalString(payload.api_endpoint_url);
  const httpMethod = asOptionalString(payload.http_method);
  const authType = asOptionalString(payload.auth_type);
  const authHeaderName = asOptionalString(payload.auth_header_name);
  const recipientField = asOptionalString(payload.recipient_field);
  const subjectField = asOptionalString(payload.subject_field);
  const htmlBodyField = asOptionalString(payload.html_body_field);
  const textBodyField = asOptionalString(payload.text_body_field);
  const staticHeaders = parseOptionalObject(payload.static_headers, 'static_headers');
  const staticPayload = parseOptionalObject(payload.static_payload, 'static_payload');
  const successResponsePath = asOptionalString(payload.success_response_path);
  const errorResponsePath = asOptionalString(payload.error_response_path);
  if (providerType === 'custom_api') {
    if ((httpMethod ?? 'POST').toUpperCase() !== 'POST') throw badRequest('http_method must be POST');
    if (!apiEndpointUrl) throw badRequest('api_endpoint_url is required for custom_api');
    if (!authType || !['bearer_token', 'api_key_header'].includes(authType)) {
      throw badRequest('auth_type must be bearer_token | api_key_header');
    }
    if (!apiKey) throw badRequest('api_key is required for custom_api');
    if (!authHeaderName) throw badRequest('auth_header_name is required for custom_api');
    if (!recipientField || !subjectField || !htmlBodyField || !textBodyField) {
      throw badRequest('recipient_field, subject_field, html_body_field, text_body_field are required for custom_api');
    }
  }
  const configured =
    providerType === 'smtp'
      ? Boolean(fromEmail && fromName && smtpHost && smtpPort && smtpUser && smtpPassword)
      : providerType === 'custom_api'
        ? Boolean(
            fromEmail &&
              fromName &&
              apiKey &&
              apiEndpointUrl &&
              authType &&
              authHeaderName &&
              recipientField &&
              subjectField &&
              htmlBodyField &&
              textBodyField
          )
        : Boolean(fromEmail && fromName && apiKey);

  const saveBlob: Record<string, unknown> = {
    provider_type: providerType,
    provider_display_name: providerDisplayName,
    from_email: fromEmail,
    from_name: fromName,
    api_key_encrypted: encryptOptionalSecret(apiKey),
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_user: smtpUser,
    smtp_password_encrypted: encryptOptionalSecret(smtpPassword),
    api_endpoint_url: apiEndpointUrl,
    http_method: httpMethod ? httpMethod.toUpperCase() : null,
    auth_type: authType,
    auth_header_name: authHeaderName,
    recipient_field: recipientField,
    subject_field: subjectField,
    html_body_field: htmlBodyField,
    text_body_field: textBodyField,
    static_headers_json: staticHeaders,
    static_payload_json: staticPayload,
    success_response_path: successResponsePath,
    error_response_path: errorResponsePath,
    is_configured: configured,
  };
  if (configScope === 'organization_override') {
    await saveOwnerEmailProviderConfigOrgOverride(String(organizationIdForOverride), saveBlob, ctx.user.id);
  } else {
    await saveOwnerEmailProviderConfigGlobal(saveBlob, ctx.user.id);
  }
  await audit(
    ctx,
    AUDIT_ACTIONS.EMAIL_PROVIDER_CONFIG_SAVED,
    'owner_email_provider_config',
    configScope === 'organization_override' ? String(organizationIdForOverride) : 'global',
    {
    provider_type: providerType,
    provider_display_name: providerDisplayName,
    from_email: fromEmail,
    from_name: fromName,
    config_scope: configScope,
    organization_id: organizationIdForOverride,
    is_configured: configured,
  });
  return {
    ok: true,
    command: 'save_email_provider_config',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

async function handleSavePlatformPublicUrl(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  const appPublicUrl = asString(payload.app_public_url, 'app_public_url');
  if (!/^https?:\/\//i.test(appPublicUrl)) {
    throw badRequest('app_public_url must start with http:// or https://');
  }
  try {
    // Validate URL format.
    void new URL(appPublicUrl);
  } catch {
    throw badRequest('app_public_url must be a valid URL');
  }
  await savePlatformPublicUrlGlobal(appPublicUrl, ctx.user.id);
  await audit(ctx, AUDIT_ACTIONS.PLATFORM_PUBLIC_URL_SAVED, 'platform_setting', 'app_public_url', {
    app_public_url: appPublicUrl,
  });
  return {
    ok: true,
    command: 'save_platform_public_url',
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

/**
 * Updates catalog pricing in `module_plans` (single source of truth with Modules/Billing).
 * `update_package_price` uses the same store — there is no separate package price table.
 */
async function handleUpdateModulePlanPricing(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  command: 'update_module_price' | 'update_package_price',
  action: string
): Promise<CountryPackCommandResponse> {
  const modulePlanId = asString(payload.module_plan_id, 'module_plan_id');
  const rawPrice = payload.price_amount;
  if (rawPrice === undefined || rawPrice === null) throw badRequest('price_amount is required');
  const num = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(num) || num < 0) throw badRequest('Invalid price_amount');

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('module_plans')
    .select('id, module_id, code, currency, billing_period, price_amount, is_active')
    .eq('id', modulePlanId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw notFound('Module plan not found');

  let currency = existing.currency as string;
  if (payload.currency !== undefined) {
    const c = asString(payload.currency, 'currency').toUpperCase();
    if (c.length !== 3) throw badRequest('currency must be a 3-letter code');
    currency = c;
  }

  let billing_period = existing.billing_period as string;
  if (payload.billing_period !== undefined && payload.billing_period !== null) {
    const bp = asString(payload.billing_period, 'billing_period').toLowerCase();
    if (bp !== 'month' && bp !== 'year') throw badRequest("billing_period must be 'month' or 'year'");
    billing_period = bp;
  }

  let is_active = existing.is_active as boolean;
  if (typeof payload.is_active === 'boolean') {
    is_active = payload.is_active;
  }

  const { error: updErr } = await supabaseAdmin
    .from('module_plans')
    .update({
      price_amount: num,
      currency,
      billing_period,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', modulePlanId);
  if (updErr) throw updErr;

  await audit(ctx, action, 'module_plan', modulePlanId, {
    command,
    module_id: existing.module_id,
    plan_code: existing.code,
    previous_price_amount: existing.price_amount,
    price_amount: num,
    currency,
    billing_period,
    is_active,
  });
  return {
    ok: true,
    command,
    refreshed: await refreshedOwnerLegalControlPanel(ctx),
  };
}

function parseRequestTemplateDefinitionItems(payload: Record<string, unknown>): { label: string; description: string | null }[] {
  const raw = payload.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('items must be a non-empty array');
  }
  return raw.map((it, i) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      throw badRequest(`items[${i}] must be an object`);
    }
    const o = it as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) throw badRequest(`items[${i}].label is required`);
    if (o.description === undefined || o.description === null) {
      return { label, description: null };
    }
    if (typeof o.description !== 'string') throw badRequest(`items[${i}].description must be a string`);
    const d = o.description.trim();
    return { label, description: d.length ? d : null };
  });
}

async function handleSaveRequestTemplateDefinition(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  const countryCode = asString(payload.country_code, 'country_code').toUpperCase().slice(0, 2);
  await assertCountryExists(countryCode);
  const name = asString(payload.name, 'name');
  const items = parseRequestTemplateDefinitionItems(payload);
  const existingId = asOptionalString(payload.template_definition_id);

  if (existingId) {
    const { data: row, error: findErr } = await supabaseAdmin
      .from('docflow_request_template_definitions')
      .select('id, archived_at')
      .eq('id', existingId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!row) throw notFound('Template not found');
    if (row.archived_at) throw badRequest('Template is archived');

    const { error: uErr } = await supabaseAdmin
      .from('docflow_request_template_definitions')
      .update({
        country_code: countryCode,
        name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingId);
    if (uErr) throw uErr;

    const { error: dErr } = await supabaseAdmin
      .from('docflow_request_template_definition_items')
      .delete()
      .eq('template_definition_id', existingId);
    if (dErr) throw dErr;

    const ins = items.map((it, idx) => ({
      template_definition_id: existingId,
      sort_order: idx,
      label: it.label,
      description: it.description,
    }));
    const { error: iErr } = await supabaseAdmin.from('docflow_request_template_definition_items').insert(ins);
    if (iErr) throw iErr;

    await audit(ctx, AUDIT_ACTIONS.DOCFLOW_REQUEST_TEMPLATE_SAVED, 'docflow_request_template_definition', existingId, {
      country_code: countryCode,
      name,
      item_count: items.length,
    });
    return { ok: true, command: 'save_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
  }

  const { data: created, error: cErr } = await supabaseAdmin
    .from('docflow_request_template_definitions')
    .insert({ country_code: countryCode, name })
    .select('id')
    .single();
  if (cErr) throw cErr;
  const newId = String(created.id);
  const ins = items.map((it, idx) => ({
    template_definition_id: newId,
    sort_order: idx,
    label: it.label,
    description: it.description,
  }));
  const { error: iErr } = await supabaseAdmin.from('docflow_request_template_definition_items').insert(ins);
  if (iErr) throw iErr;

  await audit(ctx, AUDIT_ACTIONS.DOCFLOW_REQUEST_TEMPLATE_SAVED, 'docflow_request_template_definition', newId, {
    country_code: countryCode,
    name,
    item_count: items.length,
  });
  return { ok: true, command: 'save_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
}

async function handleArchiveRequestTemplateDefinition(
  ctx: RequestContext,
  payload: Record<string, unknown>
): Promise<CountryPackCommandResponse> {
  const id = asString(payload.template_definition_id, 'template_definition_id');
  const { data: row, error: findErr } = await supabaseAdmin
    .from('docflow_request_template_definitions')
    .select('id, archived_at')
    .eq('id', id)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) throw notFound('Template not found');
  if (row.archived_at) {
    return { ok: true, command: 'archive_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
  }

  const { error: uErr } = await supabaseAdmin
    .from('docflow_request_template_definitions')
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (uErr) throw uErr;

  await audit(ctx, AUDIT_ACTIONS.DOCFLOW_REQUEST_TEMPLATE_ARCHIVED, 'docflow_request_template_definition', id, {});
  return { ok: true, command: 'archive_request_template_definition', refreshed: await refreshedOwnerLegalControlPanel(ctx) };
}

export async function executeCountryPackCommand(
  ctx: RequestContext,
  command: CountryPackCommand
): Promise<CountryPackCommandResponse> {
  try {
    assertPlatformOwner(ctx);
  } catch (error) {
    await audit(ctx, AUDIT_ACTIONS.OWNER_SECURITY_CHECK_FAILED, 'country_pack_command', null, {
      attempted_command: command.command,
    });
    throw error;
  }

  switch (command.command) {
    case 'create_country':
      return handleCreateCountry(ctx, command.payload);
    case 'create_country_pack':
      return handleCreateCountryPack(ctx, command.payload);
    case 'enable_country_pack':
      return handleEnableDisablePack(
        ctx,
        command.payload,
        'enabled',
        'enable_country_pack',
        AUDIT_ACTIONS.COUNTRY_PACK_ENABLED
      );
    case 'disable_country_pack':
      return handleEnableDisablePack(
        ctx,
        command.payload,
        'disabled',
        'disable_country_pack',
        AUDIT_ACTIONS.COUNTRY_PACK_DISABLED
      );
    case 'create_ruleset':
      return handleCreateRuleset(ctx, command.payload);
    case 'update_ruleset_metadata':
      return handleUpdateRulesetMetadata(ctx, command.payload);
    case 'activate_ruleset':
      return handleActivateDeactivateRuleset(
        ctx,
        command.payload,
        'active',
        'activate_ruleset',
        AUDIT_ACTIONS.RULESET_ACTIVATED
      );
    case 'deactivate_ruleset':
      return handleActivateDeactivateRuleset(
        ctx,
        command.payload,
        'disabled',
        'deactivate_ruleset',
        AUDIT_ACTIONS.RULESET_DEACTIVATED
      );
    case 'assign_country_pack_to_organization':
      return handleAssignCountryPack(ctx, command.payload);
    case 'change_active_ruleset_for_organization':
      return handleChangeActiveRulesetForOrganization(ctx, command.payload);
    case 'update_organization_country_settings':
      return handleUpdateOrganizationCountrySettings(ctx, command.payload);
    case 'create_legal_value':
      return handleCreateLegalValue(ctx, command.payload);
    case 'update_legal_value_metadata':
      return handleUpdateLegalValueMetadata(ctx, command.payload);
    case 'create_legal_value_version':
      return handleCreateLegalValueVersion(ctx, command.payload);
    case 'update_legal_value_version':
      return handleUpdateLegalValueVersion(ctx, command.payload);
    case 'activate_legal_value_version':
      return handleActivateDeactivateLegalValueVersion(
        ctx,
        command.payload,
        'active',
        'activate_legal_value_version',
        AUDIT_ACTIONS.LEGAL_VALUE_VERSION_ACTIVATED
      );
    case 'deactivate_legal_value_version':
      return handleActivateDeactivateLegalValueVersion(
        ctx,
        command.payload,
        'disabled',
        'deactivate_legal_value_version',
        AUDIT_ACTIONS.LEGAL_VALUE_VERSION_DEACTIVATED
      );
    case 'update_owner_note':
      return updateLegalValueMetadataField(
        ctx,
        command.payload,
        'owner_note',
        AUDIT_ACTIONS.OWNER_NOTE_UPDATED,
        'update_owner_note'
      );
    case 'update_usage_hint':
      return updateLegalValueMetadataField(
        ctx,
        command.payload,
        'usage_hint',
        AUDIT_ACTIONS.USAGE_HINT_UPDATED,
        'update_usage_hint'
      );
    case 'update_module_scope':
      return updateLegalValueMetadataField(
        ctx,
        command.payload,
        'module_scope',
        AUDIT_ACTIONS.MODULE_SCOPE_UPDATED,
        'update_module_scope'
      );
    case 'update_module_price':
      return handleUpdateModulePlanPricing(ctx, command.payload, 'update_module_price', AUDIT_ACTIONS.MODULE_PRICE_UPDATED);
    case 'update_package_price':
      return handleUpdateModulePlanPricing(ctx, command.payload, 'update_package_price', AUDIT_ACTIONS.PACKAGE_PRICE_UPDATED);
    case 'create_module_plan':
      return handleCreateModulePlan(ctx, command.payload);
    case 'save_email_provider_config':
      return handleSaveEmailProviderConfig(ctx, command.payload);
    case 'save_platform_public_url':
      return handleSavePlatformPublicUrl(ctx, command.payload);
    case 'save_request_template_definition':
      return handleSaveRequestTemplateDefinition(ctx, command.payload);
    case 'archive_request_template_definition':
      return handleArchiveRequestTemplateDefinition(ctx, command.payload);
    case 'extend_org_module_trial':
      return handleExtendOrgModuleTrial(ctx, command.payload);
    case 'activate_org_module_access':
      return handleActivateOrgModuleAccess(ctx, command.payload);
    case 'create_pricing_adjustment':
      return handleCreatePricingAdjustment(ctx, command.payload);
    case 'cancel_pricing_adjustment':
      return handleCancelPricingAdjustment(ctx, command.payload);
    default:
      throw badRequest(`Unsupported country-pack command: ${(command as { command?: string }).command ?? 'unknown'}`);
  }
}

