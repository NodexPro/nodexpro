import crypto from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { encryptOptionalSecret } from '../../shared/owner-email-provider-config.service.js';
import { RBAC_PERMISSIONS, requireRbacPermission } from '../rbac/rbac.service.js';
import { resolvePersistedUiLanguage } from '../platform-localization/platform-localization.pure.js';
import {
  mapCatalogRow,
  publicProviderView,
  STATIC_PAYMENT_PROVIDER_CATALOG,
  type PaymentProviderCatalogRow,
  type PaymentScenario,
} from './payment-provider-catalog.pure.js';
import { catalogOnlyAdapter, sellerContextForScenario } from './payment-adapter.pure.js';
import { paymentCopy, paymentUiLang } from './payment-copy.pure.js';
import { digestWebhookPayload, redactPaymentLog, webhookMayMutateState } from './payment-webhook.pure.js';

export const OWNER_PAYMENTS_AGGREGATE_KEY = 'owner_payments_aggregate';
export const OFFICE_PAYMENTS_AGGREGATE_KEY = 'office_payments_aggregate';

const OWNER_TABS = [
  'providers',
  'platform_billing',
  'office_providers',
  'transactions',
  'subscriptions',
  'diagnostics',
] as const;

export async function loadPaymentProviderCatalog(): Promise<PaymentProviderCatalogRow[]> {
  const { data, error } = await supabaseAdmin
    .from('payment_provider_catalog')
    .select(
      'code, display_name, adapter_status, supported_scenarios, supported_countries, environment_modes, capability_hosted_checkout, capability_payment_links, capability_recurring_billing, capability_refunds, capability_webhook_verification, capability_merchant_onboarding, capability_connected_accounts, capability_split_payments, capability_international_cards, capability_three_d_secure, capability_platform_fee, notes',
    )
    .order('display_name');
  if (error || !data?.length) return STATIC_PAYMENT_PROVIDER_CATALOG;
  return data.map((row) => mapCatalogRow(row as Parameters<typeof mapCatalogRow>[0]));
}

export async function buildOwnerPaymentsAggregate(ctx: RequestContext) {
  assertPlatformOwner(ctx);
  const copy = paymentCopy('en');
  const providers = (await loadPaymentProviderCatalog()).map(publicProviderView);
  const { data: credentialRows } = await supabaseAdmin
    .from('platform_payment_provider_credentials')
    .select('provider_code, environment_mode, credentials_configured, updated_at');
  const { data: connections } = await supabaseAdmin
    .from('organization_payment_connections')
    .select('organization_id, scenario, provider_code, status, kyc_status, credentials_configured, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);
  const { data: transactions } = await supabaseAdmin
    .from('payment_transactions')
    .select('id, organization_id, seller_context, scenario, provider_code, status, amount, currency, created_at')
    .eq('seller_context', 'nodexpro_platform')
    .order('created_at', { ascending: false })
    .limit(50);
  const { data: subscriptions } = await supabaseAdmin
    .from('platform_billing_subscriptions')
    .select('organization_id, kind, status, quantity, currency, billing_period, current_period_end')
    .order('updated_at', { ascending: false })
    .limit(50);

  return {
    aggregate_key: OWNER_PAYMENTS_AGGREGATE_KEY,
    ui: {
      locale: 'en',
      direction: 'ltr',
      text: copy,
      tabs: OWNER_TABS.map((id) => ({ id, label: copy[`tab_${id}`] })),
    },
    providers,
    platform_credentials: (credentialRows ?? []).map((row) => ({
      provider_code: row.provider_code,
      environment_mode: row.environment_mode,
      credentials_configured: row.credentials_configured === true,
      updated_at: row.updated_at,
    })),
    office_connections: connections ?? [],
    transactions: transactions ?? [],
    subscriptions: subscriptions ?? [],
    diagnostics: {
      ready_adapter_count: providers.filter((row) => row.adapter_status === 'ready').length,
      checkout_available: false,
      client_redirect_is_payment_proof: false,
      money_contexts_separated: true,
      note: copy.diagnostics_note,
    },
    available_actions: {
      save_platform_payment_provider_credentials: false,
      reason: copy.no_ready_adapter,
    },
  };
}

export async function buildOfficePaymentsAggregate(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.payments_office_read);
  const lang = paymentUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = paymentCopy(lang);
  const providers = (await loadPaymentProviderCatalog()).map(publicProviderView);
  const { data: connections } = await supabaseAdmin
    .from('organization_payment_connections')
    .select('scenario, provider_code, status, kyc_status, credentials_configured, last_error_code')
    .eq('organization_id', orgId);
  const byScenario = new Map((connections ?? []).map((row) => [row.scenario, row]));
  const canConnect = ctx.membership?.roleCode === 'owner' || ctx.membership?.roleCode === 'admin';
  const { data: paymentRequests } = await supabaseAdmin
    .from('payment_requests')
    .select('id, income_document_id, staff_seat_purchase_intent_id, status, checkout_url, created_at')
    .eq('organization_id', orgId)
    .eq('seller_context', 'office')
    .order('created_at', { ascending: false })
    .limit(20);

  function card(scenario: 'OFFICE_EXTERNAL' | 'OFFICE_EMBEDDED') {
    const connection = byScenario.get(scenario);
    const scenarioProviders = providers.filter((row) => row.supported_scenarios.includes(scenario));
    const hasReadyAdapter = scenarioProviders.some((row) => row.adapter_status === 'ready');
    return {
      scenario,
      title: scenario === 'OFFICE_EXTERNAL' ? copy.external_title : copy.embedded_title,
      body: scenario === 'OFFICE_EXTERNAL' ? copy.external_body : copy.embedded_body,
      status: connection?.status ?? 'unavailable',
      status_label: copy.unavailable,
      kyc_status: connection?.kyc_status ?? 'unavailable',
      provider_code: connection?.provider_code ?? null,
      steps: [copy.unavailable_steps],
      providers: scenarioProviders,
      available_actions: {
        start: {
          action_key: scenario === 'OFFICE_EXTERNAL' ? 'start_office_external_onboarding' : 'start_office_embedded_onboarding',
          enabled: canConnect && hasReadyAdapter,
          label: scenario === 'OFFICE_EXTERNAL' ? copy.start_external : copy.start_embedded,
        },
        disconnect: { action_key: 'disconnect_office_payment_provider', enabled: Boolean(connection) && canConnect, label: copy.disconnect },
        enter_api_keys: { enabled: false },
      },
    };
  }

  return {
    aggregate_key: OFFICE_PAYMENTS_AGGREGATE_KEY,
    organization_id: orgId,
    ui: { locale: lang, direction: lang === 'he' ? 'rtl' : 'ltr', text: copy },
    seller_context: 'office' as const,
    platform_seller_separated: true,
    cards: [card('OFFICE_EXTERNAL'), card('OFFICE_EMBEDDED')],
    payment_requests: (paymentRequests ?? []).map((row) => ({
      ...row,
      checkout_url: null,
      checkout_available: false,
      work_engine_reminder_eligible: false,
      accounting_base_written: false,
    })),
    checkout_available: false,
  };
}

export async function executeOwnerPaymentCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
) {
  assertPlatformOwner(ctx);
  if (command === 'save_platform_payment_provider_credentials') {
    const catalog = await loadPaymentProviderCatalog();
    const code = String(payload.provider_code ?? '').trim();
    const provider = catalog.find((row) => row.code === code);
    if (!provider || provider.adapter_status !== 'ready') {
      throw badRequest('Provider adapter is not ready', 'PAYMENT_ADAPTER_NOT_READY');
    }
    const secret = String(payload.api_key ?? payload.secret ?? '').trim();
    if (!secret) throw badRequest('api_key required', 'PAYMENT_SECRET_REQUIRED');
    const encrypted = encryptOptionalSecret(secret);
    if (!encrypted) throw badRequest('Unable to store credentials', 'PAYMENT_SECRET_REQUIRED');
    const mode = payload.environment_mode === 'live' ? 'live' : 'test';
    const { error } = await supabaseAdmin.from('platform_payment_provider_credentials').upsert(
      {
        provider_code: code,
        environment_mode: mode,
        credentials_encrypted: encrypted,
        credentials_configured: true,
        updated_by_user_id: ctx.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider_code' },
    );
    if (error) throw error;
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'platform_payment_provider_credentials',
      entityId: code,
      action: AUDIT_ACTIONS.PAYMENT_PLATFORM_CREDENTIALS_SET,
      payload: redactPaymentLog({ provider_code: code, environment_mode: mode }),
    });
    return { ok: true as const, command, owner_payments_aggregate: await buildOwnerPaymentsAggregate(ctx) };
  }
  throw badRequest('Unknown payment command', 'UNKNOWN_COMMAND');
}

export async function executeOfficePaymentCommand(
  ctx: RequestContext,
  orgId: string,
  command: string,
  payload: Record<string, unknown>,
) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.payments_office_connect);
  const scenario =
    command === 'start_office_external_onboarding'
      ? 'OFFICE_EXTERNAL'
      : command === 'start_office_embedded_onboarding'
        ? 'OFFICE_EMBEDDED'
        : command === 'disconnect_office_payment_provider'
          ? String(payload.scenario ?? '')
          : '';
  if (command === 'start_office_external_onboarding' || command === 'start_office_embedded_onboarding') {
    if (payload.api_key || payload.secret || payload.credentials) {
      throw badRequest('API keys are not accepted until an adapter is ready', 'PAYMENT_ADAPTER_NOT_READY');
    }
    const catalog = await loadPaymentProviderCatalog();
    const ready = catalog.find((row) => row.adapter_status === 'ready' && row.supported_scenarios.includes(scenario as PaymentScenario));
    if (!ready) {
      await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'organization_payment_connections',
        action: AUDIT_ACTIONS.PAYMENT_OFFICE_ONBOARDING_BLOCKED,
        payload: { command, scenario, reason: 'adapter_not_ready' },
      });
      throw badRequest('Provider adapter is not ready', 'PAYMENT_ADAPTER_NOT_READY');
    }
  }
  if (command === 'create_invoice_payment_request') {
    const incomeDocumentId = String(payload.income_document_id ?? '').trim();
    if (!incomeDocumentId) throw badRequest('income_document_id required', 'BAD_REQUEST');
    const { data: doc, error: docError } = await supabaseAdmin
      .from('income_documents')
      .select('id')
      .eq('id', incomeDocumentId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (docError) throw docError;
    if (!doc) throw badRequest('Income document not found', 'INCOME_DOCUMENT_NOT_FOUND');
    const { data: request, error } = await supabaseAdmin
      .from('payment_requests')
      .insert({
        organization_id: orgId,
        seller_context: 'office',
        income_document_id: incomeDocumentId,
        status: 'unavailable',
        checkout_url: null,
      })
      .select('id, status')
      .maybeSingle();
    if (error) throw error;
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      entityType: 'payment_request',
      entityId: request?.id ?? null,
      action: AUDIT_ACTIONS.PAYMENT_INVOICE_REQUEST_CREATED,
      payload: { income_document_id: incomeDocumentId, checkout_available: false, accounting_base_written: false },
    });
    return {
      ok: true as const,
      command,
      payment_request: { id: request?.id ?? null, status: 'unavailable', checkout_url: null, checkout_available: false },
      office_payments_aggregate: await buildOfficePaymentsAggregate(ctx, orgId),
    };
  }
  if (command === 'disconnect_office_payment_provider') {
    if (scenario !== 'OFFICE_EXTERNAL' && scenario !== 'OFFICE_EMBEDDED') {
      throw badRequest('scenario required', 'BAD_REQUEST');
    }
    await supabaseAdmin
      .from('organization_payment_connections')
      .update({ status: 'disabled', credentials_encrypted: null, credentials_configured: false, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('scenario', scenario);
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      entityType: 'organization_payment_connections',
      action: AUDIT_ACTIONS.PAYMENT_OFFICE_PROVIDER_DISCONNECTED,
      payload: { scenario },
    });
    return { ok: true as const, command, office_payments_aggregate: await buildOfficePaymentsAggregate(ctx, orgId) };
  }
  throw badRequest('Provider adapter is not ready', 'PAYMENT_ADAPTER_NOT_READY');
}

export async function ingestPaymentWebhook(input: {
  providerCode: string;
  headers: Record<string, string>;
  rawBody: string;
}) {
  const catalog = await loadPaymentProviderCatalog();
  const provider = catalog.find((row) => row.code === input.providerCode);
  const adapter = catalogOnlyAdapter(input.providerCode, provider?.capabilities ?? {
    hosted_checkout: false,
    payment_links: false,
    recurring_billing: false,
    refunds: false,
    webhook_verification: false,
    merchant_onboarding: false,
    connected_accounts: false,
    split_payments: false,
    international_cards: false,
    three_d_secure: false,
    platform_fee: false,
  });
  const verified = adapter.verifyWebhook({ headers: input.headers, rawBody: input.rawBody, secret: '' });
  const eventId = crypto.createHash('sha256').update(`${input.providerCode}:${input.rawBody}`).digest('hex').slice(0, 32);
  const digest = digestWebhookPayload(input.rawBody);
  const { data: existing } = await supabaseAdmin
    .from('payment_webhook_events')
    .select('processed, signature_ok')
    .eq('provider_code', input.providerCode)
    .eq('provider_event_id', eventId)
    .maybeSingle();
  const gate = webhookMayMutateState({
    signatureOk: verified.ok === true,
    alreadyProcessed: existing?.processed === true,
  });
  await supabaseAdmin.from('payment_webhook_events').upsert(
    {
      provider_code: input.providerCode,
      provider_event_id: eventId,
      signature_ok: verified.ok === true,
      processed: false,
      payload_digest: digest,
    },
    { onConflict: 'provider_code,provider_event_id' },
  );
  if (!gate.ok) {
    return { ok: false as const, code: gate.code, seller_context_note: sellerContextForScenario('PLATFORM_BILLING') };
  }
  return { ok: false as const, code: 'PAYMENT_ADAPTER_NOT_READY' as const };
}

export function isOwnerPaymentCommand(command: string): boolean {
  return command === 'save_platform_payment_provider_credentials';
}

export function isOfficePaymentCommand(command: string): boolean {
  return (
    command === 'start_office_external_onboarding' ||
    command === 'start_office_embedded_onboarding' ||
    command === 'disconnect_office_payment_provider' ||
    command === 'create_invoice_payment_request'
  );
}
