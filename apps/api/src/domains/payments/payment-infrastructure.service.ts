import crypto from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { encryptOptionalSecret } from '../../shared/owner-email-provider-config.service.js';
import { RBAC_PERMISSIONS, requireRbacPermission } from '../rbac/rbac.service.js';
import { resolvePersistedUiLanguage } from '../platform-localization/platform-localization.pure.js';
import { formatSeatMoneyAmount } from './staff-seat-purchase-quote.pure.js';
import {
  hidingProviderKeepsExistingConnection,
  localizedPayoutTerms,
  localizedProviderDescription,
  localizedProviderName,
  mapCatalogRow,
  officeCanCollectSecrets,
  officeCanStartNewConnection,
  officeCredentialFields,
  officeSeesProvider,
  parseUpsertPaymentProviderPayload,
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

const CATALOG_SELECT =
  'code, display_name, display_name_he, adapter_status, supported_scenarios, supported_countries, environment_modes, capability_hosted_checkout, capability_payment_links, capability_recurring_billing, capability_refunds, capability_webhook_verification, capability_merchant_onboarding, capability_connected_accounts, capability_split_payments, capability_international_cards, capability_three_d_secure, capability_platform_fee, notes, logo_url, description_en, description_he, show_in_billing, allow_new_connections, commission_percent, connection_fee_amount, monthly_fee_amount, fee_currency, payout_terms_en, payout_terms_he, terms_url';

export async function loadPaymentProviderCatalog(): Promise<PaymentProviderCatalogRow[]> {
  const { data, error } = await supabaseAdmin
    .from('payment_provider_catalog')
    .select(CATALOG_SELECT)
    .order('display_name');
  if (error || !data?.length) return STATIC_PAYMENT_PROVIDER_CATALOG;
  return data.map((row) => mapCatalogRow(row as Parameters<typeof mapCatalogRow>[0]));
}

function commercialLabels(row: PaymentProviderCatalogRow, lang: 'en' | 'he', copy: Record<string, string>) {
  const currency = row.fee_currency || 'ILS';
  return {
    commission_label:
      row.commission_percent != null ? `${row.commission_percent}%` : copy.no_fee_published,
    connection_fee_label:
      row.connection_fee_amount != null ? formatSeatMoneyAmount(row.connection_fee_amount, currency) : copy.no_fee_published,
    monthly_fee_label:
      row.monthly_fee_amount != null ? formatSeatMoneyAmount(row.monthly_fee_amount, currency) : copy.no_fee_published,
    payout_terms: localizedPayoutTerms(row, lang),
    terms_url: row.terms_url,
  };
}

export async function buildOwnerPaymentsAggregate(ctx: RequestContext) {
  assertPlatformOwner(ctx);
  const lang = paymentUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = paymentCopy(lang);
  const catalog = await loadPaymentProviderCatalog();
  const providers = catalog.map((row) => {
    const view = publicProviderView(row);
    const commercial = commercialLabels(row, lang, copy);
    return {
      ...view,
      display_name: row.display_name,
      label: localizedProviderName(row, lang),
      description: localizedProviderDescription(row, lang),
      adapter_label: row.adapter_status === 'ready' ? copy.adapter_ready : copy.adapter_catalog,
      commercial,
      office_preview: {
        display_name: localizedProviderName(row, lang),
        description: localizedProviderDescription(row, lang),
        shown_in_billing: row.show_in_billing,
        new_connections_allowed: row.allow_new_connections && row.show_in_billing,
        connect_enabled: officeCanStartNewConnection(row),
        commercial,
        hide_keeps_existing: hidingProviderKeepsExistingConnection(),
      },
      available_commands: {
        upsert_payment_provider_catalog: { enabled: true },
        save_platform_payment_provider_credentials: { enabled: row.adapter_status === 'ready' },
      },
    };
  });
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
      locale: lang,
      direction: lang === 'he' ? 'rtl' : 'ltr',
      text: copy,
      tabs: OWNER_TABS.map((id) => ({ id, label: copy[`tab_${id}`] })),
    },
    providers,
    candidates: ['hyp', 'max'],
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
      adapter_toggle_blocked: copy.adapter_toggle_blocked,
      hidden_keeps_connection: copy.hidden_keeps_connection,
    },
    available_actions: {
      upsert_payment_provider_catalog: true,
      save_platform_payment_provider_credentials: providers.some((row) => row.adapter_status === 'ready'),
      reason: copy.no_ready_adapter,
    },
  };
}

export async function buildOfficePaymentsAggregate(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.payments_office_read);
  const lang = paymentUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = paymentCopy(lang);
  const catalog = await loadPaymentProviderCatalog();
  const { data: connections } = await supabaseAdmin
    .from('organization_payment_connections')
    .select('scenario, provider_code, status, kyc_status, credentials_configured, last_error_code, merchant_reference, last_verify_ok')
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

  function kycLabel(status: string | null | undefined) {
    if (status === 'pending') return copy.kyc_pending;
    if (status === 'approved') return copy.adapter_ready;
    return copy.kyc_not_started;
  }

  function card(scenario: 'OFFICE_EXTERNAL' | 'OFFICE_EMBEDDED') {
    const connection = byScenario.get(scenario);
    const scenarioProviders = catalog.filter(
      (row) =>
        row.supported_scenarios.includes(scenario) && officeSeesProvider(row, connection?.provider_code ?? null),
    );
    const selected = scenarioProviders.find((row) => row.code === connection?.provider_code) ?? null;
    const collectSecrets = selected ? officeCanCollectSecrets(selected) : false;
    const canStartNew = scenarioProviders.some((row) => officeCanStartNewConnection(row));
    const steps =
      scenario === 'OFFICE_EXTERNAL'
        ? [copy.ext_step_1, copy.ext_step_2, copy.ext_step_3, copy.ext_step_4]
        : [copy.emb_step_1, copy.emb_step_2, copy.emb_step_3, copy.emb_step_4];
    const blocked =
      scenario === 'OFFICE_EXTERNAL'
        ? collectSecrets
          ? null
          : copy.keys_not_collected
        : canStartNew
          ? null
          : copy.partner_not_ready;
    return {
      scenario,
      path: scenario === 'OFFICE_EXTERNAL' ? 'A' : 'B',
      title: scenario === 'OFFICE_EXTERNAL' ? copy.external_title : copy.embedded_title,
      body: scenario === 'OFFICE_EXTERNAL' ? copy.external_body : copy.embedded_body,
      status_label: selected ? localizedProviderName(selected, lang) : copy.unavailable,
      application_status: kycLabel(connection?.kyc_status),
      merchant_note: copy.office_merchant_note,
      merchant_reference: connection?.merchant_reference ?? null,
      credentials_configured: connection?.credentials_configured === true,
      last_verify_ok: connection?.last_verify_ok === true,
      blocked_reason: blocked,
      provider_choices_label: copy.supported_providers,
      provider_choices: scenarioProviders.map((row) => ({
        code: row.code,
        display_name: localizedProviderName(row, lang),
        description: localizedProviderDescription(row, lang),
        logo_url: row.logo_url,
        commercial: commercialLabels(row, lang, copy),
        collect_secrets: officeCanCollectSecrets(row),
        can_start: officeCanStartNewConnection(row) || (connection?.provider_code === row.code && officeCanCollectSecrets(row)),
        credential_fields: officeCredentialFields(row, scenario).map((field) => ({
          ...field,
          label: copy[field.key] ?? field.key,
        })),
      })),
      steps,
      available_actions: {
        start: {
          action_key: scenario === 'OFFICE_EXTERNAL' ? 'start_office_external_onboarding' : 'start_office_embedded_onboarding',
          enabled: canConnect && (scenario === 'OFFICE_EMBEDDED' ? canStartNew : collectSecrets),
          label: scenario === 'OFFICE_EXTERNAL' ? copy.start_external : copy.start_embedded,
        },
        save_credentials: {
          action_key: 'save_office_external_credentials',
          enabled: canConnect && scenario === 'OFFICE_EXTERNAL' && collectSecrets,
          label: copy.save_provider,
        },
        verify: {
          action_key: 'verify_office_payment_connection',
          enabled: canConnect && collectSecrets && connection?.credentials_configured === true,
          label: copy.verify_connection,
        },
        activate: {
          action_key: 'activate_office_payment_connection',
          enabled: canConnect && collectSecrets && connection?.last_verify_ok === true,
          label: copy.activate_connection,
        },
        disconnect: { action_key: 'disconnect_office_payment_provider', enabled: Boolean(connection) && canConnect, label: copy.disconnect },
        enter_api_keys: { enabled: collectSecrets },
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
  if (command === 'upsert_payment_provider_catalog') {
    const parsed = parseUpsertPaymentProviderPayload(payload);
    if ('error' in parsed) throw badRequest(parsed.error, parsed.error);
    if (payload.adapter_status) {
      throw badRequest('A visibility switch does not activate a payment adapter', 'PAYMENT_ADAPTER_TOGGLE_BLOCKED');
    }
    const existing = (await loadPaymentProviderCatalog()).find((row) => row.code === parsed.code);
    const { error } = await supabaseAdmin.from('payment_provider_catalog').upsert(
      {
        code: parsed.code,
        display_name: parsed.display_name,
        display_name_he: parsed.display_name_he,
        adapter_status: existing?.adapter_status ?? 'catalog_only',
        supported_scenarios: parsed.supported_scenarios,
        logo_url: parsed.logo_url,
        description_en: parsed.description_en,
        description_he: parsed.description_he,
        show_in_billing: parsed.show_in_billing,
        allow_new_connections: parsed.allow_new_connections,
        commission_percent: parsed.commission_percent,
        connection_fee_amount: parsed.connection_fee_amount,
        monthly_fee_amount: parsed.monthly_fee_amount,
        fee_currency: parsed.fee_currency,
        payout_terms_en: parsed.payout_terms_en,
        payout_terms_he: parsed.payout_terms_he,
        terms_url: parsed.terms_url,
        notes: existing?.notes ?? 'Listed only. No signed adapter.',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'code' },
    );
    if (error) throw error;
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'payment_provider_catalog',
      entityId: parsed.code,
      action: AUDIT_ACTIONS.PAYMENT_PROVIDER_CATALOG_UPSERTED,
      payload: {
        code: parsed.code,
        show_in_billing: parsed.show_in_billing,
        allow_new_connections: parsed.allow_new_connections,
        adapter_status: existing?.adapter_status ?? 'catalog_only',
        hide_keeps_existing: hidingProviderKeepsExistingConnection(),
      },
    });
    return { ok: true as const, command, owner_payments_aggregate: await buildOwnerPaymentsAggregate(ctx) };
  }
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
  const catalog = await loadPaymentProviderCatalog();
  if (command === 'start_office_external_onboarding' || command === 'start_office_embedded_onboarding') {
    if (payload.api_key || payload.secret || payload.credentials) {
      const providerCode = String(payload.provider_code ?? '').trim();
      const provider = catalog.find((row) => row.code === providerCode);
      if (!provider || !officeCanCollectSecrets(provider)) {
        throw badRequest('API keys are not accepted until an adapter is ready', 'PAYMENT_ADAPTER_NOT_READY');
      }
    }
    const providerCode = String(payload.provider_code ?? '').trim();
    const provider = catalog.find(
      (row) => row.code === providerCode && row.supported_scenarios.includes(scenario as PaymentScenario),
    );
    if (!provider || !officeCanStartNewConnection(provider)) {
      await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'organization_payment_connections',
        action: AUDIT_ACTIONS.PAYMENT_OFFICE_ONBOARDING_BLOCKED,
        payload: { command, scenario, reason: 'adapter_not_ready' },
      });
      throw badRequest('Provider adapter is not ready', 'PAYMENT_ADAPTER_NOT_READY');
    }
    const status = scenario === 'OFFICE_EMBEDDED' ? 'pending_kyc' : 'draft';
    const kyc = scenario === 'OFFICE_EMBEDDED' ? 'pending' : 'not_started';
    const { error } = await supabaseAdmin.from('organization_payment_connections').upsert(
      {
        organization_id: orgId,
        scenario,
        provider_code: provider.code,
        status,
        kyc_status: kyc,
        credentials_configured: false,
        last_verify_ok: false,
        last_verified_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,scenario' },
    );
    if (error) throw error;
    return { ok: true as const, command, office_payments_aggregate: await buildOfficePaymentsAggregate(ctx, orgId) };
  }
  if (command === 'save_office_external_credentials') {
    const providerCode = String(payload.provider_code ?? '').trim();
    const provider = catalog.find((row) => row.code === providerCode && row.supported_scenarios.includes('OFFICE_EXTERNAL'));
    if (!provider || !officeCanCollectSecrets(provider)) {
      throw badRequest('API keys are not accepted until an adapter is ready', 'PAYMENT_ADAPTER_NOT_READY');
    }
    const merchantId = String(payload.merchant_id ?? '').trim();
    const apiKey = String(payload.api_key ?? payload.secret ?? '').trim();
    if (!merchantId || !apiKey) throw badRequest('merchant_id and api_key required', 'PAYMENT_SECRET_REQUIRED');
    const encrypted = encryptOptionalSecret(JSON.stringify({ merchant_id: merchantId, api_key: apiKey }));
    if (!encrypted) throw badRequest('Unable to store credentials', 'PAYMENT_SECRET_REQUIRED');
    const { error } = await supabaseAdmin.from('organization_payment_connections').upsert(
      {
        organization_id: orgId,
        scenario: 'OFFICE_EXTERNAL',
        provider_code: provider.code,
        status: 'draft',
        environment_mode: 'test',
        merchant_reference: merchantId,
        credentials_encrypted: encrypted,
        credentials_configured: true,
        last_verify_ok: false,
        last_verified_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,scenario' },
    );
    if (error) throw error;
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      entityType: 'organization_payment_connections',
      action: AUDIT_ACTIONS.PAYMENT_OFFICE_CREDENTIALS_SAVED,
      payload: redactPaymentLog({ provider_code: provider.code, scenario: 'OFFICE_EXTERNAL', merchant_id: merchantId }),
    });
    return { ok: true as const, command, office_payments_aggregate: await buildOfficePaymentsAggregate(ctx, orgId) };
  }
  if (command === 'verify_office_payment_connection' || command === 'activate_office_payment_connection') {
    const connScenario = String(payload.scenario ?? scenario ?? '') as PaymentScenario;
    const { data: connection } = await supabaseAdmin
      .from('organization_payment_connections')
      .select('provider_code, credentials_configured, last_verify_ok, kyc_status, status')
      .eq('organization_id', orgId)
      .eq('scenario', connScenario)
      .maybeSingle();
    const provider = catalog.find((row) => row.code === connection?.provider_code);
    if (!provider || !officeCanCollectSecrets(provider)) {
      await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'organization_payment_connections',
        action:
          command === 'verify_office_payment_connection'
            ? AUDIT_ACTIONS.PAYMENT_OFFICE_VERIFY_BLOCKED
            : AUDIT_ACTIONS.PAYMENT_OFFICE_ACTIVATE_BLOCKED,
        payload: { scenario: connScenario, reason: 'adapter_not_ready' },
      });
      throw badRequest('Provider adapter is not ready', 'PAYMENT_ADAPTER_NOT_READY');
    }
    if (command === 'activate_office_payment_connection' && connection?.last_verify_ok !== true) {
      throw badRequest('Connection is not verified', 'PAYMENT_CONNECTION_NOT_VERIFIED');
    }
    throw badRequest('Provider adapter is not ready', 'PAYMENT_ADAPTER_NOT_READY');
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
  return command === 'save_platform_payment_provider_credentials' || command === 'upsert_payment_provider_catalog';
}

export function isOfficePaymentCommand(command: string): boolean {
  return (
    command === 'start_office_external_onboarding' ||
    command === 'start_office_embedded_onboarding' ||
    command === 'save_office_external_credentials' ||
    command === 'verify_office_payment_connection' ||
    command === 'activate_office_payment_connection' ||
    command === 'disconnect_office_payment_provider' ||
    command === 'create_invoice_payment_request'
  );
}
