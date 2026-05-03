import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { resolveCountryContext } from '../country-pack/country-pack-resolver.service.js';
import type { DocflowCommandResponse, DocflowCommandType, DocflowCommunicationLegalValuePayload } from './docflow.types.js';
import {
  assertClientBelongsToOrg,
  assertDocflowEntitled,
  assertOfficeScope,
  asOptionalString,
  reqString,
} from './docflow.guards.js';
import { createSystemMessageCore } from './docflow-system-message-core.service.js';
import { buildDocflowFloatingWidgetAggregate } from './docflow-floating-widget.service.js';

const COMMUNICATION_WRITE_PERM = 'docflow:system_message_write';
const DOCFLOW_REVIEW_RBAC_PERM = 'docflow.review';

type SkippedClient = { client_id: string; reason: string };
type TargetResolution = {
  clientIds: string[];
  skipped: SkippedClient[];
  summary: string;
  auditPayload: Record<string, unknown>;
};

function normalizeDeliveryView(
  rawStatus: string | null,
  rawReason: string | null
): { status: string | null; reason: string | null } {
  if (!rawStatus) return { status: null, reason: null };
  if (rawStatus === 'pending' && rawReason === 'client_portal_not_activated') {
    return { status: 'pending_client_access', reason: 'client_portal_not_activated' };
  }
  if (rawStatus === 'sent' && rawReason === 'sent_internal') {
    return { status: 'sent_internal', reason: null };
  }
  if (rawStatus === 'sent') return { status: 'sent', reason: null };
  return { status: rawStatus, reason: rawReason };
}

/**
 * Permission layer for communication-rule office commands (run rule, draft review, etc.).
 * Required: `docflow:system_message_write` OR `docflow.review` on ctx.membership.permissions
 * (RBAC seeds 090/091 + rbac.service expansion).
 *
 * Hebrew UI "אין הרשאה לביצוע הפעולה" comes from apps/web/src/api/client.ts (403/FORBIDDEN),
 * not from this message string.
 */
export function canRunDocflowCommunicationRules(ctx: RequestContext): boolean {
  const perms = ctx.membership?.permissions ?? [];
  return perms.includes(COMMUNICATION_WRITE_PERM) || perms.includes(DOCFLOW_REVIEW_RBAC_PERM);
}

/** POST .../docflow/commands run_communication_rule → executeDocflowCommunicationOfficeCommand: throws here if check fails. */
function assertCommunicationPermission(ctx: RequestContext): void {
  if (!canRunDocflowCommunicationRules(ctx)) {
    console.warn('[docflow][deny] assertCommunicationPermission', {
      user_email: ctx.user.email ?? null,
      user_id: ctx.user.id ?? null,
      org_id: ctx.organizationId ?? null,
      role: ctx.membership?.roleCode ?? null,
      actual_permissions: ctx.membership?.permissions ?? [],
      required_any_of: [COMMUNICATION_WRITE_PERM, DOCFLOW_REVIEW_RBAC_PERM],
    });
    throw forbidden('Insufficient permission for communication rules');
  }
}

export function parseDocflowCommunicationPayload(raw: unknown): DocflowCommunicationLegalValuePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('Invalid communication rule payload');
  }
  const o = raw as Record<string, unknown>;
  if (o.type !== 'docflow_communication') {
    throw badRequest('Legal value payload is not a DocFlow communication rule');
  }
  const messageTemplate = typeof o.message_template === 'string' ? o.message_template.trim() : '';
  if (!messageTemplate) throw badRequest('message_template is required in communication rule payload');
  const messageType = o.message_type === 'reminder' ? 'reminder' : 'system';
  const reviewRequired = o.review_required !== false;
  return {
    type: 'docflow_communication',
    message_template: messageTemplate,
    review_required: reviewRequired,
    target_filter: o.target_filter as DocflowCommunicationLegalValuePayload['target_filter'],
    condition_config:
      o.condition_config && typeof o.condition_config === 'object' && !Array.isArray(o.condition_config)
        ? (o.condition_config as Record<string, unknown>)
        : undefined,
    schedule_config:
      o.schedule_config && typeof o.schedule_config === 'object' && !Array.isArray(o.schedule_config)
        ? (o.schedule_config as Record<string, unknown>)
        : undefined,
    message_type: messageType,
  };
}

async function evaluateCommunicationCondition(
  orgId: string,
  clientId: string,
  conditionConfig: Record<string, unknown> | undefined
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = conditionConfig && typeof conditionConfig === 'object' && !Array.isArray(conditionConfig) ? conditionConfig : {};
  const requireActive = cfg.require_active_obligation === true;
  const obligationTypes = Array.isArray(cfg.obligation_types)
    ? cfg.obligation_types.filter((x): x is string => typeof x === 'string')
    : [];

  const { data: rows, error } = await supabaseAdmin
    .from('client_obligations')
    .select('obligation_type, is_active')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('is_active', true);
  if (error) throw error;
  const active = rows ?? [];

  if (obligationTypes.length > 0) {
    const set = new Set(obligationTypes);
    const match = active.some((r) => set.has(r.obligation_type as string));
    if (!match) return { ok: false, reason: 'no_matching_obligation' };
  }
  if (requireActive && active.length === 0) {
    return { ok: false, reason: 'no_active_obligations' };
  }
  return { ok: true };
}

const FILTER_FLAG_ALIASES: Record<string, string> = {
  has_payroll: 'has_payroll',
  vat_bimonthly: 'vat_bimonthly',
  vat_bi_monthly: 'vat_bimonthly',
  vat_monthly: 'vat_monthly',
  income_tax_advance_monthly: 'income_tax_advance_monthly',
  income_tax_advance_bimonthly: 'income_tax_advance_bimonthly',
  income_tax_advance_bi_monthly: 'income_tax_advance_bimonthly',
  all: 'all',
  all_clients: 'all',
  selected_clients: 'selected_clients',
};

function normalizeFilterFlag(raw: string): string {
  const k = raw.trim().toLowerCase();
  return FILTER_FLAG_ALIASES[k] ?? k;
}

function isYesLike(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'כן' || v === 'yes' || v === 'true' || v === '1';
  }
  return false;
}

function humanTargetFlagLabel(flag: string): string {
  if (flag === 'has_payroll') return 'לקוחות עם מס הכנסה ניכויים = כן';
  return flag;
}

function summarizeTargetFilter(targetFilter: string | Record<string, unknown> | undefined): string {
  if (targetFilter === undefined || targetFilter === null || targetFilter === '' || targetFilter === 'all') {
    return 'All active clients';
  }
  if (typeof targetFilter === 'string') {
    const norm = normalizeFilterFlag(targetFilter);
    return norm === 'has_payroll' ? 'לקוחות עם מס הכנסה ניכויים = כן' : `Filter: ${targetFilter}`;
  }
  const mode = String((targetFilter as { mode?: string }).mode ?? '').trim().toLowerCase();
  if (mode === 'all') return 'All active clients';
  if (mode === 'selected_clients') {
    const ids = Array.isArray((targetFilter as { client_ids?: unknown[] }).client_ids)
      ? (targetFilter as { client_ids: unknown[] }).client_ids
      : [];
    return `Selected clients (${ids.length})`;
  }
  if (mode === 'filtered') {
    const flags = Array.isArray((targetFilter as { flags?: unknown[] }).flags)
      ? (targetFilter as { flags: unknown[] }).flags.map((x) => normalizeFilterFlag(String(x)))
      : [];
    if (flags.length === 1 && flags[0] === 'has_payroll') return 'לקוחות עם מס הכנסה ניכויים = כן';
    return `Filtered (OR): ${flags.map((f) => humanTargetFlagLabel(f)).join(', ') || 'none'}`;
  }
  return `Filter mode: ${mode || 'unknown'}`;
}

async function resolveTargetClients(
  orgId: string,
  targetFilter: string | Record<string, unknown> | undefined
): Promise<TargetResolution> {
  const { data: activeClients, error: clientsErr } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('status', 'active');
  if (clientsErr) throw clientsErr;
  const allClientIds = (activeClients ?? []).map((r) => String(r.id));
  const allClientSet = new Set(allClientIds);

  const asAll = (): TargetResolution => ({
    clientIds: allClientIds,
    skipped: [],
    summary: 'All active clients',
    auditPayload: { mode: 'all' },
  });

  if (targetFilter === undefined || targetFilter === null || targetFilter === '' || targetFilter === 'all') {
    return asAll();
  }
  if (typeof targetFilter === 'string') {
    const norm = normalizeFilterFlag(targetFilter);
    if (norm === 'all') return asAll();
    throw badRequest(`Unsupported target_filter string: ${targetFilter}`);
  }
  if (typeof targetFilter !== 'object' || Array.isArray(targetFilter)) {
    throw badRequest('target_filter must be string or object');
  }

  const mode = String((targetFilter as { mode?: string }).mode ?? '').trim().toLowerCase();
  if (!mode || mode === 'all') return asAll();

  if (mode === 'selected_clients') {
    const rawIds = Array.isArray((targetFilter as { client_ids?: unknown[] }).client_ids)
      ? (targetFilter as { client_ids: unknown[] }).client_ids
      : [];
    const selectedIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))];
    if (!selectedIds.length) {
      return {
        clientIds: [],
        skipped: allClientIds.map((id) => ({ client_id: id, reason: 'selected_clients_empty' })),
        summary: 'Selected clients (0)',
        auditPayload: { mode: 'selected_clients', client_ids: [] },
      };
    }
    const allowed: string[] = [];
    const skipped: SkippedClient[] = [];
    for (const id of selectedIds) {
      if (allClientSet.has(id)) {
        allowed.push(id);
      } else {
        skipped.push({ client_id: id, reason: 'selected_client_not_in_org_or_inactive' });
      }
    }
    const notSelected = allClientIds.filter((id) => !selectedIds.includes(id));
    for (const id of notSelected) skipped.push({ client_id: id, reason: 'not_in_selected_clients' });
    return {
      clientIds: allowed,
      skipped,
      summary: `Selected clients (${allowed.length}/${selectedIds.length})`,
      auditPayload: { mode: 'selected_clients', client_ids: selectedIds },
    };
  }

  if (mode === 'filtered') {
    const rawFlags = Array.isArray((targetFilter as { flags?: unknown[] }).flags)
      ? (targetFilter as { flags: unknown[] }).flags.map((x) => String(x))
      : [];
    const normalizedFlags = [...new Set(rawFlags.map((f) => normalizeFilterFlag(f)).filter(Boolean))];
    if (!normalizedFlags.length) {
      return {
        clientIds: [],
        skipped: allClientIds.map((id) => ({ client_id: id, reason: 'target_filter_no_flags' })),
        summary: 'Filtered (OR): no flags',
        auditPayload: { mode: 'filtered', flags: [] },
      };
    }
    if (normalizedFlags.includes('all')) return asAll();
    const unsupported = normalizedFlags.filter(
      (f) =>
        f !== 'has_payroll' &&
        f !== 'vat_bimonthly' &&
        f !== 'vat_monthly' &&
        f !== 'income_tax_advance_monthly' &&
        f !== 'income_tax_advance_bimonthly'
    );
    if (unsupported.length) {
      return {
        clientIds: [],
        skipped: allClientIds.map((id) => ({ client_id: id, reason: `unsupported_filter_flag:${unsupported[0]}` })),
        summary: `Filtered (OR): unsupported ${unsupported.join(', ')}`,
        auditPayload: { mode: 'filtered', flags: normalizedFlags, unsupported_flags: unsupported },
      };
    }

    const { data: taxRows, error: taxErr } = await supabaseAdmin
      .from('client_tax_settings')
      .select('client_id, income_tax_deductions_enabled, vat_frequency, income_tax_advance_enabled, income_tax_advance_frequency')
      .eq('organization_id', orgId)
      .in('client_id', allClientIds);
    if (taxErr) throw taxErr;
    const taxByClient = new Map<
      string,
      {
        income_tax_deductions_enabled: unknown;
        vat_frequency: string | null;
        income_tax_advance_enabled: boolean;
        income_tax_advance_frequency: string | null;
      }
    >();
    for (const row of taxRows ?? []) {
      taxByClient.set(String(row.client_id), {
        income_tax_deductions_enabled: row.income_tax_deductions_enabled,
        vat_frequency: row.vat_frequency ? String(row.vat_frequency) : null,
        income_tax_advance_enabled: row.income_tax_advance_enabled === true,
        income_tax_advance_frequency: row.income_tax_advance_frequency ? String(row.income_tax_advance_frequency) : null,
      });
    }

    const matched = new Set<string>();
    const unmatchedReasonByClient = new Map<string, string>();
    for (const clientId of allClientIds) {
      const tax = taxByClient.get(clientId) ?? {
        income_tax_deductions_enabled: false,
        vat_frequency: null,
        income_tax_advance_enabled: false,
        income_tax_advance_frequency: null,
      };
      const perFlagReasons: string[] = [];
      const hit = normalizedFlags.some((flag) => {
        if (flag === 'has_payroll') {
          const ok = isYesLike(tax.income_tax_deductions_enabled);
          if (!ok) perFlagReasons.push('has_payroll_not_yes');
          return ok;
        }
        if (flag === 'vat_bimonthly') return tax.vat_frequency === 'bi_monthly';
        if (flag === 'vat_monthly') return tax.vat_frequency === 'monthly';
        if (flag === 'income_tax_advance_monthly') {
          return tax.income_tax_advance_enabled && tax.income_tax_advance_frequency === 'monthly';
        }
        if (flag === 'income_tax_advance_bimonthly') {
          return tax.income_tax_advance_enabled && tax.income_tax_advance_frequency === 'bi_monthly';
        }
        return false;
      });
      if (hit) matched.add(clientId);
      else if (perFlagReasons.length) unmatchedReasonByClient.set(clientId, perFlagReasons[0]);
    }
    const skipped = allClientIds
      .filter((id) => !matched.has(id))
      .map((id) => ({ client_id: id, reason: unmatchedReasonByClient.get(id) ?? 'target_filter_no_match' }));
    const humanFlags = normalizedFlags.map((f) => humanTargetFlagLabel(f));
    const humanSummary =
      normalizedFlags.length === 1 && normalizedFlags[0] === 'has_payroll'
        ? 'לקוחות עם מס הכנסה ניכויים = כן'
        : `Filtered (OR): ${humanFlags.join(', ')}`;
    return {
      clientIds: [...matched],
      skipped,
      summary: humanSummary,
      auditPayload: { mode: 'filtered', flags: normalizedFlags, behavior: 'or' },
    };
  }

  throw badRequest(`Unsupported target_filter mode: ${mode}`);
}

export async function buildCommunicationRuleRunReviewAggregate(
  orgId: string,
  ruleRunId: string
): Promise<Record<string, unknown>> {
  const { data: run, error: runErr } = await supabaseAdmin
    .from('communication_rule_runs')
    .select('*')
    .eq('id', ruleRunId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (runErr) throw runErr;
  if (!run) throw notFound('Rule run not found');

  const { data: drafts, error: dErr } = await supabaseAdmin
    .from('communication_draft_messages')
    .select('*')
    .eq('rule_run_id', ruleRunId)
    .eq('org_id', orgId)
    .order('generated_at', { ascending: true });
  if (dErr) throw dErr;

  const clientIds = [...new Set((drafts ?? []).map((d) => d.client_id as string))];
  const displayByClient = new Map<string, string | null>();
  if (clientIds.length) {
    const { data: cRows, error: cNameErr } = await supabaseAdmin
      .from('clients')
      .select('id, display_name')
      .in('id', clientIds);
    if (cNameErr) throw cNameErr;
    for (const c of cRows ?? []) displayByClient.set(c.id as string, (c.display_name as string) ?? null);
  }

  const { data: lv, error: lvErr } = await supabaseAdmin
    .from('country_legal_values')
    .select('id, value_key, label, module_scope, country_code')
    .eq('id', run.source_legal_value_id)
    .maybeSingle();
  if (lvErr) throw lvErr;

  const skippedDetail = (run.skipped_detail as SkippedClient[] | null) ?? [];
  const activePortalByClient = new Map<string, boolean>();
  if (clientIds.length) {
    const { data: portalRows, error: pErr } = await supabaseAdmin
      .from('client_portal_users')
      .select('client_id, status')
      .eq('org_id', orgId)
      .in('client_id', clientIds);
    if (pErr) throw pErr;
    for (const cid of clientIds) activePortalByClient.set(cid, false);
    for (const p of portalRows ?? []) {
      if (String(p.status ?? '') === 'active') {
        activePortalByClient.set(String(p.client_id), true);
      }
    }
  }
  let targetFilterSummary = 'All active clients';
  try {
    const context = await resolveCountryContext(orgId, String(run.run_date));
    const raw = context.resolved_values_map[String(run.source_value_key)];
    if (raw !== undefined) {
      const parsed = parseDocflowCommunicationPayload(raw);
      targetFilterSummary = summarizeTargetFilter(parsed.target_filter);
    }
  } catch {
    // Keep aggregate resilient; summary is auxiliary.
  }

  const draftThreadIds = [...new Set((drafts ?? []).map((d) => String(d.thread_id ?? '')).filter(Boolean))];
  const latestDeliveryByThread = new Map<string, { delivery_status: string; delivery_reason: string | null }>();
  if (draftThreadIds.length) {
    const { data: sentMessages, error: sentErr } = await supabaseAdmin
      .from('client_messages')
      .select('id, thread_id, created_at')
      .eq('org_id', orgId);
    if (sentErr) throw sentErr;
    const relevant = (sentMessages ?? [])
      .filter((m) => draftThreadIds.includes(String(m.thread_id)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const latestMessageIds: string[] = [];
    for (const m of relevant) {
      const threadId = String(m.thread_id ?? '');
      if (!threadId || latestDeliveryByThread.has(threadId)) continue;
      latestDeliveryByThread.set(threadId, { delivery_status: '', delivery_reason: null });
      latestMessageIds.push(String(m.id));
    }
    if (latestMessageIds.length) {
      const { data: deliveries, error: dErr } = await supabaseAdmin
        .from('client_message_deliveries')
        .select('message_id, delivery_status, failure_reason')
        .eq('org_id', orgId)
        .eq('channel', 'docflow')
        .in('message_id', latestMessageIds);
      if (dErr) throw dErr;
      const deliveryByMessage = new Map<string, { delivery_status: string; delivery_reason: string | null }>();
      for (const d of deliveries ?? []) {
        const normalized = normalizeDeliveryView(
          String(d.delivery_status ?? ''),
          d.failure_reason ? String(d.failure_reason) : null
        );
        deliveryByMessage.set(String(d.message_id), {
          delivery_status: normalized.status ?? '',
          delivery_reason: normalized.reason,
        });
      }
      for (const m of relevant) {
        const threadId = String(m.thread_id ?? '');
        if (!threadId || !latestDeliveryByThread.has(threadId)) continue;
        const msgDelivery = deliveryByMessage.get(String(m.id));
        if (msgDelivery) latestDeliveryByThread.set(threadId, msgDelivery);
      }
    }
  }

  const draftRows = (drafts ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const cid = String(r.client_id ?? '');
    const st = String(r.status ?? '');
    const hasActivePortal = activePortalByClient.get(cid) === true;
    const allowed: { command: string; enabled: boolean; reason: string | null }[] = [
      {
        command: 'edit_draft_message',
        enabled: st === 'draft',
        reason: st === 'draft' ? null : 'Only draft can be edited',
      },
      {
        command: 'approve_draft_message',
        enabled: st === 'draft',
        reason: st === 'draft' ? null : 'Only draft can be approved',
      },
      {
        command: 'cancel_draft_message',
        enabled: st === 'draft' || st === 'approved',
        reason: st === 'draft' || st === 'approved' ? null : 'Already finalized',
      },
      {
        command: 'send_approved_message',
        enabled: st === 'approved' && hasActivePortal,
        reason:
          st !== 'approved'
            ? 'Approve before send'
            : !hasActivePortal
              ? 'client_portal_not_activated'
              : null,
      },
    ];
    const delivery = latestDeliveryByThread.get(String(r.thread_id ?? ''));
    return {
      id: r.id,
      client_id: r.client_id,
      client_display_name: displayByClient.get(cid) ?? null,
      thread_id: r.thread_id,
      module_key: r.module_key,
      message_body: r.message_body,
      message_type: r.message_type,
      status: r.status,
      idempotency_key: r.idempotency_key,
      generated_at: r.generated_at,
      reviewed_by: r.reviewed_by,
      sent_at: r.sent_at,
      cancelled_at: r.cancelled_at,
      delivery_status: delivery?.delivery_status ?? null,
      delivery_reason: delivery?.delivery_reason ?? null,
      allowed_actions: allowed,
    };
  });

  const hasDraft = draftRows.some((d) => d.status === 'draft');
  const hasApproved = draftRows.some((d) => d.status === 'approved');

  return {
    aggregate_key: 'communication_rule_run_review_aggregate',
    run: {
      id: run.id,
      org_id: run.org_id,
      source_legal_value_id: run.source_legal_value_id,
      source_value_key: run.source_value_key,
      source_ruleset_id: run.source_ruleset_id,
      module_key: run.module_key,
      run_date: run.run_date,
      run_context_key: run.run_context_key,
      status: run.status,
      generated_count: run.generated_count,
      skipped_count: run.skipped_count,
      target_filter_summary: targetFilterSummary,
      created_at: run.created_at,
    },
    source_rule: lv
      ? {
          legal_value_id: lv.id,
          value_key: lv.value_key,
          label: lv.label,
          module_scope: lv.module_scope,
          country_code: lv.country_code,
        }
      : null,
    skipped_clients: skippedDetail,
    drafts: draftRows,
    client_summary: {
      draft_count: draftRows.filter((d) => d.status === 'draft').length,
      approved_count: draftRows.filter((d) => d.status === 'approved').length,
      sent_count: draftRows.filter((d) => d.status === 'sent').length,
      cancelled_count: draftRows.filter((d) => d.status === 'cancelled').length,
    },
    allowed_actions: [
      {
        command: 'edit_draft_message',
        enabled: hasDraft,
        reason: hasDraft ? null : 'No draft rows',
      },
      {
        command: 'approve_draft_message',
        enabled: hasDraft,
        reason: hasDraft ? null : 'No draft rows',
      },
      {
        command: 'cancel_draft_message',
        enabled: hasDraft || hasApproved,
        reason: hasDraft || hasApproved ? null : 'Nothing to cancel',
      },
      {
        command: 'send_approved_message',
        enabled: hasApproved,
        reason: hasApproved ? null : 'No approved drafts',
      },
    ],
  };
}

async function refreshedReview(orgId: string, ruleRunId: string): Promise<DocflowCommandResponse['refreshed']> {
  return {
    aggregate_key: 'communication_rule_run_review_aggregate',
    aggregate: await buildCommunicationRuleRunReviewAggregate(orgId, ruleRunId),
  };
}

async function refreshedAfterCommunicationCommand(
  orgId: string,
  ruleRunId: string,
  payload: Record<string, unknown>,
  ctx: RequestContext
): Promise<DocflowCommandResponse['refreshed']> {
  const target = asOptionalString(payload.refresh_aggregate);
  if (target === 'docflow_floating_widget_aggregate') {
    const canUse = canRunDocflowCommunicationRules(ctx);
    return {
      aggregate_key: 'docflow_floating_widget_aggregate',
      aggregate: await buildDocflowFloatingWidgetAggregate(orgId, { can_use_communication_commands: canUse }),
    };
  }
  return refreshedReview(orgId, ruleRunId);
}

export async function executeDocflowCommunicationOfficeCommand(
  ctx: RequestContext,
  command: DocflowCommandType,
  payloadInput: unknown
): Promise<DocflowCommandResponse> {
  const payload =
    payloadInput && typeof payloadInput === 'object' && !Array.isArray(payloadInput)
      ? (payloadInput as Record<string, unknown>)
      : {};
  const orgId = reqString(payload, 'org_id');
  assertOfficeScope(ctx, orgId);
  await assertDocflowEntitled(orgId);
  assertCommunicationPermission(ctx);

  const actorUserId = ctx.user.id;

  switch (command) {
    case 'run_communication_rule': {
      const valueKey = reqString(payload, 'value_key');
      const runDateRaw = asOptionalString(payload.run_date) ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(runDateRaw)) throw badRequest('run_date must be YYYY-MM-DD');
      const runContextKey = asOptionalString(payload.run_context_key) ?? '';

      const { data: org, error: orgErr } = await supabaseAdmin
        .from('organizations')
        .select('country_code')
        .eq('id', orgId)
        .maybeSingle();
      if (orgErr) throw orgErr;
      if (!org?.country_code) throw notFound('Organization not found');

      const ctxResolved = await resolveCountryContext(orgId, runDateRaw);
      const rawResolved = ctxResolved.resolved_values_map[valueKey];
      if (rawResolved === undefined) {
        throw badRequest('Communication rule not found in active ruleset context for this date');
      }
      const comm = parseDocflowCommunicationPayload(rawResolved);
      const targetResolved = await resolveTargetClients(orgId, comm.target_filter);

      const { data: lvRow, error: lvErr } = await supabaseAdmin
        .from('country_legal_values')
        .select('id, value_key, module_scope, country_code')
        .eq('country_code', org.country_code as string)
        .eq('value_key', valueKey)
        .maybeSingle();
      if (lvErr) throw lvErr;
      if (!lvRow) throw badRequest('Legal value not found for organization country');
      if (!ctxResolved.ruleset_id) throw badRequest('No active ruleset for organization');

      const moduleKey = String(lvRow.module_scope ?? '').trim();
      if (!moduleKey) throw badRequest('module_scope is required on legal value');

      const { data: modCheck, error: modErr } = await supabaseAdmin.from('modules').select('id').eq('code', moduleKey).maybeSingle();
      if (modErr) throw modErr;
      if (!modCheck) throw badRequest('module_scope must match a registered module code');

      const insertRun = {
        org_id: orgId,
        source_legal_value_id: lvRow.id,
        source_value_key: valueKey,
        source_ruleset_id: ctxResolved.ruleset_id,
        module_key: moduleKey,
        run_date: runDateRaw,
        run_context_key: runContextKey,
        status: 'completed' as const,
        generated_count: 0,
        skipped_count: 0,
        skipped_detail: [] as SkippedClient[],
      };

      let runId: string;
      const { data: insertedRun, error: insErr } = await supabaseAdmin
        .from('communication_rule_runs')
        .insert(insertRun)
        .select('id')
        .single();

      if (insErr) {
        if (insErr.code === '23505') {
          const { data: existing, error: exErr } = await supabaseAdmin
            .from('communication_rule_runs')
            .select('id')
            .eq('org_id', orgId)
            .eq('source_legal_value_id', lvRow.id)
            .eq('source_ruleset_id', ctxResolved.ruleset_id)
            .eq('run_date', runDateRaw)
            .eq('run_context_key', runContextKey)
            .maybeSingle();
          if (exErr) throw exErr;
          if (!existing) throw insErr;
          runId = existing.id;
          await writeAudit({
            organizationId: orgId,
            actorUserId,
            moduleCode: 'docflow',
            entityType: 'communication_rule_run',
            entityId: runId,
            action: 'communication_rule_run_started',
            payload: { duplicate: true, value_key: valueKey },
          });
          return {
            ok: true,
            command,
            refreshed: await refreshedReview(orgId, runId),
          };
        }
        throw insErr;
      }
      runId = insertedRun!.id;

      await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'communication_rule_run',
        entityId: runId,
        action: 'communication_rule_run_started',
        payload: {
          value_key: valueKey,
          run_date: runDateRaw,
          run_context_key: runContextKey,
          target_filter: targetResolved.auditPayload,
          target_filter_summary: targetResolved.summary,
        },
      });
      const skipped: SkippedClient[] = [...targetResolved.skipped];
      let generated = 0;

      for (const clientId of targetResolved.clientIds) {
        const cond = await evaluateCommunicationCondition(orgId, clientId, comm.condition_config);
        if (!cond.ok) {
          skipped.push({ client_id: clientId, reason: cond.reason });
          continue;
        }

        const idempotencyKey = `comm:${valueKey}:${runContextKey}:${runDateRaw}:${clientId}`;
        const initialStatus = comm.review_required === false ? 'approved' : 'draft';

        const { error: draftErr } = await supabaseAdmin.from('communication_draft_messages').insert({
          org_id: orgId,
          rule_run_id: runId,
          client_id: clientId,
          module_key: moduleKey,
          message_body: comm.message_template,
          message_type: comm.message_type ?? 'system',
          status: initialStatus,
          idempotency_key: idempotencyKey,
          reviewed_by: initialStatus === 'approved' ? actorUserId : null,
        });

        if (draftErr) {
          if (draftErr.code === '23505') {
            continue;
          }
          throw draftErr;
        }
        generated += 1;
        await writeAudit({
          organizationId: orgId,
          actorUserId,
          moduleCode: 'docflow',
          entityType: 'communication_draft_message',
          entityId: null,
          action: 'communication_draft_generated',
          payload: { rule_run_id: runId, client_id: clientId, value_key: valueKey },
        });
      }

      const { error: upRunErr } = await supabaseAdmin
        .from('communication_rule_runs')
        .update({
          generated_count: generated,
          skipped_count: skipped.length,
          skipped_detail: skipped,
        })
        .eq('id', runId);
      if (upRunErr) throw upRunErr;

      return { ok: true, command, refreshed: await refreshedReview(orgId, runId) };
    }

    case 'approve_draft_message': {
      const ruleRunId = reqString(payload, 'rule_run_id');
      const draftId = reqString(payload, 'draft_id');
      const { data: draft, error } = await supabaseAdmin
        .from('communication_draft_messages')
        .select('*')
        .eq('id', draftId)
        .eq('rule_run_id', ruleRunId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      if (!draft) throw notFound('Draft not found');
      if (draft.status !== 'draft') throw badRequest('Draft is not in draft status');
      await assertClientBelongsToOrg(orgId, draft.client_id as string);

      const { error: uErr } = await supabaseAdmin
        .from('communication_draft_messages')
        .update({ status: 'approved', reviewed_by: actorUserId })
        .eq('id', draftId);
      if (uErr) throw uErr;

      await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'communication_draft_message',
        entityId: draftId,
        action: 'communication_draft_approved',
        payload: { rule_run_id: ruleRunId, client_id: draft.client_id },
      });

      return { ok: true, command, refreshed: await refreshedAfterCommunicationCommand(orgId, ruleRunId, payload, ctx) };
    }

    case 'edit_draft_message': {
      const ruleRunId = reqString(payload, 'rule_run_id');
      const draftId = reqString(payload, 'draft_id');
      const messageBody = reqString(payload, 'message_body');

      const { data: draft, error } = await supabaseAdmin
        .from('communication_draft_messages')
        .select('*')
        .eq('id', draftId)
        .eq('rule_run_id', ruleRunId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      if (!draft) throw notFound('Draft not found');
      if (draft.status !== 'draft') throw badRequest('Only draft messages can be edited');
      await assertClientBelongsToOrg(orgId, draft.client_id as string);

      const { error: uErr } = await supabaseAdmin.from('communication_draft_messages').update({ message_body: messageBody }).eq('id', draftId);
      if (uErr) throw uErr;

      await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'communication_draft_message',
        entityId: draftId,
        action: 'communication_draft_edited',
        payload: { rule_run_id: ruleRunId, client_id: draft.client_id },
      });

      return { ok: true, command, refreshed: await refreshedReview(orgId, ruleRunId) };
    }

    case 'cancel_draft_message': {
      const ruleRunId = reqString(payload, 'rule_run_id');
      const draftId = reqString(payload, 'draft_id');

      const { data: draft, error } = await supabaseAdmin
        .from('communication_draft_messages')
        .select('*')
        .eq('id', draftId)
        .eq('rule_run_id', ruleRunId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      if (!draft) throw notFound('Draft not found');
      if (draft.status !== 'draft' && draft.status !== 'approved') throw badRequest('Cannot cancel this draft');
      await assertClientBelongsToOrg(orgId, draft.client_id as string);

      const { error: uErr } = await supabaseAdmin
        .from('communication_draft_messages')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', draftId);
      if (uErr) throw uErr;

      await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'communication_draft_message',
        entityId: draftId,
        action: 'communication_draft_cancelled',
        payload: { rule_run_id: ruleRunId, client_id: draft.client_id },
      });

      return { ok: true, command, refreshed: await refreshedAfterCommunicationCommand(orgId, ruleRunId, payload, ctx) };
    }

    case 'send_approved_message': {
      const ruleRunId = reqString(payload, 'rule_run_id');
      const draftId = reqString(payload, 'draft_id');

      const { data: draft, error } = await supabaseAdmin
        .from('communication_draft_messages')
        .select('*')
        .eq('id', draftId)
        .eq('rule_run_id', ruleRunId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      if (!draft) throw notFound('Draft not found');
      if (draft.status !== 'approved') throw badRequest('Only approved drafts can be sent');
      const clientId = draft.client_id as string;
      await assertClientBelongsToOrg(orgId, clientId);

      const { data: run, error: rErr } = await supabaseAdmin
        .from('communication_rule_runs')
        .select('source_value_key, run_context_key')
        .eq('id', ruleRunId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!run) throw notFound('Rule run not found');

      const moduleKey = draft.module_key as string;
      const messageType = draft.message_type as 'system' | 'reminder';
      const body = draft.message_body as string;
      const idempotencyKey = `communication_draft_sent:${draftId}`;
      const { data: portalAccess, error: pErr } = await supabaseAdmin
        .from('client_portal_users')
        .select('id, status')
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (pErr) throw pErr;
      const hasPortalAccess = !!portalAccess?.id;

      const out = await createSystemMessageCore({
        orgId,
        clientId,
        moduleKey,
        messageType,
        body,
        idempotencyKey,
        ruleCode: run.source_value_key as string,
        ruleContextKey: (run.run_context_key as string) || null,
        sendModeRaw: 'auto_send_allowed',
        autoSendAllowedByRule: false,
        allowPublishWithoutAutoSendRule: true,
        emitAutoSentEvent: false,
        threadIdInput: null,
        actorUserId,
      });

      const deliveryStatusView = hasPortalAccess ? 'sent_internal' : 'pending_client_access';
      const deliveryReason = hasPortalAccess ? null : 'client_portal_not_activated';
      const deliveryStatusDb = hasPortalAccess ? 'sent' : 'pending';
      const deliveryReasonDb = hasPortalAccess ? 'sent_internal' : 'client_portal_not_activated';
      const { error: dErr } = await supabaseAdmin.from('client_message_deliveries').upsert(
        {
          org_id: orgId,
          client_id: clientId,
          thread_id: out.threadId,
          message_id: out.messageId,
          channel: 'docflow',
          delivery_status: deliveryStatusDb,
          failure_reason: deliveryReasonDb,
          sent_at: hasPortalAccess ? new Date().toISOString() : null,
          attempt_count: 0,
          last_attempt_at: null,
        },
        { onConflict: 'message_id,channel' }
      );
      if (dErr) throw dErr;

      const { error: uErr } = await supabaseAdmin
        .from('communication_draft_messages')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          thread_id: out.threadId,
        })
        .eq('id', draftId);
      if (uErr) throw uErr;

      await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'communication_draft_message',
        entityId: draftId,
        action: 'communication_draft_sent',
        payload: {
          rule_run_id: ruleRunId,
          client_id: clientId,
          thread_id: out.threadId,
          message_id: out.messageId,
          delivery_status: deliveryStatusView,
          delivery_reason: deliveryReason,
        },
      });

      return { ok: true, command, refreshed: await refreshedAfterCommunicationCommand(orgId, ruleRunId, payload, ctx) };
    }

    default:
      throw badRequest(`Unsupported communication command: ${command}`);
  }
}
