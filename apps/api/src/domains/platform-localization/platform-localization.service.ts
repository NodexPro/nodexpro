import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { CANONICAL_SOURCE_EN, CANONICAL_SOURCE_HE } from './canonical-catalog.js';
import {
  DATE_FORMAT_OPTIONS,
  canPublishLanguage,
  isIso4217Code,
  isLocaleCode,
  moduleGroupForKey,
  normalizeCurrencyCode,
  placeholdersMatch,
  publishedCurrencyOptions,
  publishedLanguageOptions,
  timezoneOptions,
  translationCompleteness,
  validateLocalizationPreferences,
} from './platform-localization.pure.js';

const LOCALIZATION_COMMANDS = new Set([
  'create_platform_currency',
  'update_platform_currency',
  'publish_platform_currency',
  'deactivate_platform_currency',
  'create_platform_language',
  'update_platform_language',
  'save_platform_translation_draft',
  'publish_platform_language',
  'sync_platform_translation_catalog',
]);

type CurrencyRow = {
  code: string;
  name_en: string;
  symbol: string;
  status: string;
  version: number;
  updated_at: string;
};

type LanguageRow = {
  locale_code: string;
  name: string;
  direction: string;
  status: string;
  version: number;
  published_at: string | null;
  updated_at: string;
};

function auditBase(ctx: RequestContext) {
  return {
    organizationId: null as string | null,
    actorUserId: ctx.user.id,
  };
}

export function isPlatformLocalizationCommand(command: string): boolean {
  return LOCALIZATION_COMMANDS.has(command);
}

async function loadCurrencies(): Promise<CurrencyRow[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_currencies')
    .select('code, name_en, symbol, status, version, updated_at')
    .order('code');
  if (error) throw error;
  return (data ?? []) as CurrencyRow[];
}

async function loadLanguages(): Promise<LanguageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_languages')
    .select('locale_code, name, direction, status, version, published_at, updated_at')
    .order('locale_code');
  if (error) throw error;
  return (data ?? []) as LanguageRow[];
}

async function loadCatalogKeys(): Promise<Array<{ key: string; source_en: string; module_group: string }>> {
  const { data, error } = await supabaseAdmin
    .from('platform_translation_keys')
    .select('key, source_en, module_group')
    .order('key');
  if (error) throw error;
  return (data ?? []) as Array<{ key: string; source_en: string; module_group: string }>;
}

async function ensureCatalogSeeded(): Promise<void> {
  const existing = await loadCatalogKeys();
  if (existing.length > 0) return;
  await syncCanonicalCatalogInternal(null);
}

async function syncCanonicalCatalogInternal(actorUserId: string | null): Promise<number> {
  const rows = Object.entries(CANONICAL_SOURCE_EN).map(([key, source_en]) => ({
    key,
    source_en,
    module_group: moduleGroupForKey(key),
  }));
  const { error } = await supabaseAdmin.from('platform_translation_keys').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
  const languages = await loadLanguages();
  for (const language of languages) {
    const source = language.locale_code === 'he' ? CANONICAL_SOURCE_HE : CANONICAL_SOURCE_EN;
    const values = rows.map((row) => ({
      locale_code: language.locale_code,
      key: row.key,
      value: language.locale_code === 'en' || language.locale_code === 'he' ? (source[row.key] ?? '') : '',
      status: language.status === 'published' && (language.locale_code === 'en' || language.locale_code === 'he')
        ? 'published'
        : 'draft',
      updated_by_user_id: actorUserId,
    }));
    const { error: valueErr } = await supabaseAdmin
      .from('platform_translation_values')
      .upsert(values, { onConflict: 'locale_code,key' });
    if (valueErr) throw valueErr;
  }
  return rows.length;
}

async function languageWorkspace(locale: string) {
  await ensureCatalogSeeded();
  const languages = await loadLanguages();
  const language = languages.find((row) => row.locale_code === locale) ?? null;
  if (!language) throw badRequest('Language not found.');
  const keys = await loadCatalogKeys();
  const { data: values, error } = await supabaseAdmin
    .from('platform_translation_values')
    .select('key, value, status, updated_at')
    .eq('locale_code', locale);
  if (error) throw error;
  const byKey = new Map((values ?? []).map((row) => [row.key as string, row]));
  const entries = keys.map((keyRow) => {
    const current = byKey.get(keyRow.key);
    const value = typeof current?.value === 'string' ? current.value : '';
    return {
      key: keyRow.key,
      module_group: keyRow.module_group,
      source_en: keyRow.source_en,
      value,
      status: current?.status ?? 'draft',
      placeholder_ok: value.trim() ? placeholdersMatch(keyRow.source_en, value) : value.trim() === '',
    };
  });
  const translatedCount = entries.filter((entry) => entry.value.trim().length > 0 && entry.placeholder_ok).length;
  const placeholderFailures = entries.filter((entry) => entry.value.trim().length > 0 && !entry.placeholder_ok).length;
  const completeness = translationCompleteness({ catalogSize: keys.length, translatedCount });
  const groups = [...new Set(entries.map((entry) => entry.module_group))];
  return {
    language,
    entries,
    groups,
    completeness,
    placeholder_failures: placeholderFailures,
    catalog_size: keys.length,
    translated_count: translatedCount,
    uncovered_application_areas: [
      'Clients list and client card (bundled i18n)',
      'Dashboard V2.5',
      'Work Engine',
      'Income / documents',
      'DocFlow',
      'Users & Roles',
      'Modules and Billing',
      'Client Operations',
    ],
  };
}

export async function buildPublishedLocalizationOptions() {
  await ensureCatalogSeeded();
  const [currencies, languages] = await Promise.all([loadCurrencies(), loadLanguages()]);
  return {
    currencies: publishedCurrencyOptions(currencies),
    languages: publishedLanguageOptions(languages),
  };
}

export async function buildUserLocalizationAggregate(
  ctx: RequestContext,
  extras: {
    timezone: string | null;
    dateFormat: string | null;
    displayCurrencyCode: string | null;
    uiLanguage: string;
    orgTimezone: string | null;
    orgCountryCode: string | null;
    countryOptions: Array<{ code: string; label: string }>;
    countryPackStatus: string | null;
  },
) {
  const published = await buildPublishedLocalizationOptions();
  const currencyCodes = published.currencies.map((row) => row.code);
  const displayCurrency =
    extras.displayCurrencyCode && currencyCodes.includes(extras.displayCurrencyCode)
      ? extras.displayCurrencyCode
      : currencyCodes.includes('ILS')
        ? 'ILS'
        : currencyCodes[0] ?? 'ILS';
  const language =
    published.languages.some((row) => row.locale === extras.uiLanguage) ? extras.uiLanguage : 'en';
  return {
    country: {
      code: extras.orgCountryCode,
      options: extras.countryOptions,
      pack_status: extras.countryPackStatus,
      legal_jurisdiction_note:
        'Country is owned by Country Pack. Changing a UI preference does not silently change tax jurisdiction.',
    },
    language: {
      current: language,
      options: published.languages,
    },
    timezone: {
      current: extras.timezone && extras.timezone.trim() ? extras.timezone : extras.orgTimezone ?? 'Asia/Jerusalem',
      options: timezoneOptions(extras.orgTimezone),
      historical_note: 'Does not rewrite stored timestamps.',
    },
    date_format: {
      current: extras.dateFormat && DATE_FORMAT_OPTIONS.includes(extras.dateFormat as (typeof DATE_FORMAT_OPTIONS)[number])
        ? extras.dateFormat
        : 'DD/MM/YYYY',
      options: DATE_FORMAT_OPTIONS.map((value) => ({ value, label: value })),
    },
    display_currency: {
      current: displayCurrency,
      options: published.currencies,
      accounting_base_note:
        'Accounting Base remains the financial source of truth. Display currency does not convert invoices, rewrite entries, or change tax.',
    },
  };
}

export async function setUserLocalizationPreferences(
  ctx: RequestContext,
  payload: {
    language_code?: string;
    timezone?: string;
    date_format?: string;
    display_currency_code?: string;
  },
) {
  const published = await buildPublishedLocalizationOptions();
  const { data: current } = await supabaseAdmin
    .from('users')
    .select('ui_language, timezone, date_format, display_currency_code')
    .eq('id', ctx.user.id)
    .maybeSingle();
  const languageCode = String(payload.language_code ?? current?.ui_language ?? ctx.user.uiLanguage ?? 'en').trim();
  const timezone = String(payload.timezone ?? current?.timezone ?? 'Asia/Jerusalem').trim();
  const dateFormat = String(payload.date_format ?? current?.date_format ?? 'DD/MM/YYYY').trim();
  const displayCurrencyCode = normalizeCurrencyCode(
    String(payload.display_currency_code ?? current?.display_currency_code ?? 'ILS'),
  );
  const valid = validateLocalizationPreferences({
    languageCode,
    timezone,
    dateFormat,
    displayCurrencyCode,
    publishedLanguageLocales: published.languages.map((row) => row.locale),
    publishedCurrencyCodes: published.currencies.map((row) => row.code),
  });
  if (!valid.ok) throw badRequest(valid.message, valid.code);
  const { error } = await supabaseAdmin
    .from('users')
    .update({
      ui_language: languageCode,
      timezone,
      date_format: dateFormat,
      display_currency_code: displayCurrencyCode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ctx.user.id);
  if (error) throw error;
  await writeAudit({
    ...auditBase(ctx),
    organizationId: ctx.organizationId,
    entityType: 'user',
    entityId: ctx.user.id,
    action: AUDIT_ACTIONS.AUTH_LOCALIZATION_PREFERENCES_SET,
    payload: {
      language_code: languageCode,
      timezone,
      date_format: dateFormat,
      display_currency_code: displayCurrencyCode,
      accounting_base_unchanged: true,
    },
  });
  return { languageCode, timezone, dateFormat, displayCurrencyCode };
}

export async function buildOwnerCurrenciesAggregate(ctx: RequestContext) {
  assertPlatformOwner(ctx);
  const currencies = await loadCurrencies();
  const { data: audit } = await supabaseAdmin
    .from('audit_log')
    .select('id, action, entity_id, created_at, actor_user_id')
    .in('action', [
      AUDIT_ACTIONS.PLATFORM_CURRENCY_CREATED,
      AUDIT_ACTIONS.PLATFORM_CURRENCY_UPDATED,
      AUDIT_ACTIONS.PLATFORM_CURRENCY_PUBLISHED,
      AUDIT_ACTIONS.PLATFORM_CURRENCY_DEACTIVATED,
    ])
    .order('created_at', { ascending: false })
    .limit(40);
  return {
    aggregate_key: 'owner_currencies_aggregate',
    currencies,
    audit: audit ?? [],
    allowed_actions: [
      'create_platform_currency',
      'update_platform_currency',
      'publish_platform_currency',
      'deactivate_platform_currency',
    ],
  };
}

export async function buildOwnerLanguagesAggregate(ctx: RequestContext, localeRaw?: string) {
  assertPlatformOwner(ctx);
  await ensureCatalogSeeded();
  const languages = await loadLanguages();
  const selected = isLocaleCode(String(localeRaw ?? ''))
    ? String(localeRaw)
    : languages.find((row) => row.locale_code === 'en')?.locale_code ?? languages[0]?.locale_code ?? 'en';
  const workspace = await languageWorkspace(selected);
  return {
    aggregate_key: 'owner_languages_aggregate',
    languages,
    selected_locale: selected,
    workspace,
    ai_translation: {
      available: false,
      note: 'No approved AI translation service exists. Manual translation only.',
    },
    allowed_actions: [
      'create_platform_language',
      'update_platform_language',
      'save_platform_translation_draft',
      'publish_platform_language',
      'sync_platform_translation_catalog',
    ],
  };
}

export async function loadPublishedTranslationCatalog(locale: string): Promise<Record<string, string>> {
  if (!isLocaleCode(locale)) return {};
  const { data: language } = await supabaseAdmin
    .from('platform_languages')
    .select('locale_code, status')
    .eq('locale_code', locale)
    .maybeSingle();
  if (!language || language.status !== 'published') {
    if (locale === 'en') return { ...CANONICAL_SOURCE_EN };
    if (locale === 'he') return { ...CANONICAL_SOURCE_HE };
    return {};
  }
  const { data } = await supabaseAdmin
    .from('platform_translation_values')
    .select('key, value, status')
    .eq('locale_code', locale)
    .eq('status', 'published');
  const out: Record<string, string> = locale === 'he' ? { ...CANONICAL_SOURCE_HE } : { ...CANONICAL_SOURCE_EN };
  for (const row of data ?? []) {
    if (typeof row.key === 'string' && typeof row.value === 'string' && row.value.trim()) {
      out[row.key] = row.value;
    }
  }
  return out;
}

async function refreshedOwnerCurrencies(ctx: RequestContext) {
  return { aggregate_key: 'owner_currencies_aggregate', aggregate: await buildOwnerCurrenciesAggregate(ctx) };
}

async function refreshedOwnerLanguages(ctx: RequestContext, locale?: string) {
  return { aggregate_key: 'owner_languages_aggregate', aggregate: await buildOwnerLanguagesAggregate(ctx, locale) };
}

export async function executePlatformLocalizationCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
) {
  assertPlatformOwner(ctx);
  switch (command) {
    case 'create_platform_currency': {
      const code = normalizeCurrencyCode(String(payload.code ?? ''));
      const name_en = String(payload.name_en ?? '').trim();
      const symbol = String(payload.symbol ?? '').trim();
      if (!isIso4217Code(code)) throw badRequest('Currency code must be ISO 4217 (three letters).');
      if (!name_en || !symbol) throw badRequest('name_en and symbol are required.');
      const { error } = await supabaseAdmin.from('platform_currencies').insert({
        code,
        name_en,
        symbol,
        status: 'draft',
        created_by_user_id: ctx.user.id,
        updated_by_user_id: ctx.user.id,
      });
      if (error) throw conflict('Currency code already exists.', 'DUPLICATE_CURRENCY');
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_currency',
        entityId: code,
        action: AUDIT_ACTIONS.PLATFORM_CURRENCY_CREATED,
        payload: { code, name_en, symbol },
      });
      return { ok: true, command, refreshed: await refreshedOwnerCurrencies(ctx) };
    }
    case 'update_platform_currency': {
      const code = normalizeCurrencyCode(String(payload.code ?? ''));
      const name_en = String(payload.name_en ?? '').trim();
      const symbol = String(payload.symbol ?? '').trim();
      if (!isIso4217Code(code)) throw badRequest('Currency code must be ISO 4217 (three letters).');
      const { data: current } = await supabaseAdmin.from('platform_currencies').select('version').eq('code', code).maybeSingle();
      if (!current) throw badRequest('Currency not found.');
      const { error } = await supabaseAdmin
        .from('platform_currencies')
        .update({
          name_en,
          symbol,
          version: Number(current.version ?? 1) + 1,
          updated_at: new Date().toISOString(),
          updated_by_user_id: ctx.user.id,
        })
        .eq('code', code);
      if (error) throw error;
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_currency',
        entityId: code,
        action: AUDIT_ACTIONS.PLATFORM_CURRENCY_UPDATED,
        payload: { code, name_en, symbol },
      });
      return { ok: true, command, refreshed: await refreshedOwnerCurrencies(ctx) };
    }
    case 'publish_platform_currency': {
      const code = normalizeCurrencyCode(String(payload.code ?? ''));
      const { error } = await supabaseAdmin
        .from('platform_currencies')
        .update({ status: 'published', updated_at: new Date().toISOString(), updated_by_user_id: ctx.user.id })
        .eq('code', code);
      if (error) throw error;
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_currency',
        entityId: code,
        action: AUDIT_ACTIONS.PLATFORM_CURRENCY_PUBLISHED,
        payload: { code },
      });
      return { ok: true, command, refreshed: await refreshedOwnerCurrencies(ctx) };
    }
    case 'deactivate_platform_currency': {
      const code = normalizeCurrencyCode(String(payload.code ?? ''));
      if (code === 'ILS' || code === 'USD' || code === 'EUR') {
        throw badRequest('Initial published currencies cannot be deactivated.');
      }
      const { error } = await supabaseAdmin
        .from('platform_currencies')
        .update({ status: 'inactive', updated_at: new Date().toISOString(), updated_by_user_id: ctx.user.id })
        .eq('code', code);
      if (error) throw error;
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_currency',
        entityId: code,
        action: AUDIT_ACTIONS.PLATFORM_CURRENCY_DEACTIVATED,
        payload: { code, historical_references_preserved: true },
      });
      return { ok: true, command, refreshed: await refreshedOwnerCurrencies(ctx) };
    }
    case 'create_platform_language': {
      const locale_code = String(payload.locale_code ?? '').trim();
      const name = String(payload.name ?? '').trim();
      const direction = String(payload.direction ?? 'ltr').trim() === 'rtl' ? 'rtl' : 'ltr';
      if (!isLocaleCode(locale_code)) throw badRequest('Locale must look like en or en-US.');
      if (!name) throw badRequest('Language name is required.');
      const { error } = await supabaseAdmin.from('platform_languages').insert({
        locale_code,
        name,
        direction,
        status: 'draft',
        created_by_user_id: ctx.user.id,
        updated_by_user_id: ctx.user.id,
      });
      if (error) throw conflict('Locale already exists.', 'DUPLICATE_LANGUAGE');
      await syncCanonicalCatalogInternal(ctx.user.id);
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_LANGUAGE_CREATED,
        payload: { locale_code, name, direction },
      });
      return { ok: true, command, refreshed: await refreshedOwnerLanguages(ctx, locale_code) };
    }
    case 'update_platform_language': {
      const locale_code = String(payload.locale_code ?? '').trim();
      const name = String(payload.name ?? '').trim();
      const direction = String(payload.direction ?? 'ltr').trim() === 'rtl' ? 'rtl' : 'ltr';
      if (!isLocaleCode(locale_code)) throw badRequest('Locale must look like en or en-US.');
      const { error } = await supabaseAdmin
        .from('platform_languages')
        .update({
          name,
          direction,
          updated_at: new Date().toISOString(),
          updated_by_user_id: ctx.user.id,
        })
        .eq('locale_code', locale_code);
      if (error) throw error;
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_LANGUAGE_UPDATED,
        payload: { locale_code, name, direction },
      });
      return { ok: true, command, refreshed: await refreshedOwnerLanguages(ctx, locale_code) };
    }
    case 'save_platform_translation_draft': {
      const locale_code = String(payload.locale_code ?? '').trim();
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      if (!isLocaleCode(locale_code)) throw badRequest('Locale is required.');
      const keys = await loadCatalogKeys();
      const allowed = new Set(keys.map((row) => row.key));
      const upserts = [];
      for (const raw of entries) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const key = String((raw as { key?: unknown }).key ?? '').trim();
        const value = String((raw as { value?: unknown }).value ?? '');
        if (!allowed.has(key)) continue;
        upserts.push({
          locale_code,
          key,
          value,
          status: 'draft',
          updated_at: new Date().toISOString(),
          updated_by_user_id: ctx.user.id,
        });
      }
      if (upserts.length) {
        const { error } = await supabaseAdmin
          .from('platform_translation_values')
          .upsert(upserts, { onConflict: 'locale_code,key' });
        if (error) throw error;
      }
      await supabaseAdmin
        .from('platform_languages')
        .update({ status: 'review', updated_at: new Date().toISOString(), updated_by_user_id: ctx.user.id })
        .eq('locale_code', locale_code)
        .neq('status', 'published');
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_TRANSLATION_DRAFT_SAVED,
        payload: { locale_code, updated_keys: upserts.length },
      });
      return { ok: true, command, refreshed: await refreshedOwnerLanguages(ctx, locale_code) };
    }
    case 'publish_platform_language': {
      const locale_code = String(payload.locale_code ?? '').trim();
      if (!isLocaleCode(locale_code)) throw badRequest('Locale is required.');
      const workspace = await languageWorkspace(locale_code);
      const allowed = canPublishLanguage({
        catalogSize: workspace.catalog_size,
        translatedCount: workspace.translated_count,
        placeholderFailures: workspace.placeholder_failures,
      });
      if (!allowed.ok) throw badRequest(allowed.message, allowed.code);
      const nextVersion = Number(workspace.language.version ?? 1) + 1;
      await supabaseAdmin
        .from('platform_languages')
        .update({
          status: 'published',
          version: nextVersion,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by_user_id: ctx.user.id,
        })
        .eq('locale_code', locale_code);
      await supabaseAdmin
        .from('platform_translation_values')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('locale_code', locale_code);
      await supabaseAdmin.from('platform_language_versions').insert({
        locale_code,
        version: nextVersion,
        status: 'published',
        completeness_ratio: workspace.completeness.ratio,
        published_at: new Date().toISOString(),
        published_by_user_id: ctx.user.id,
      });
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_LANGUAGE_PUBLISHED,
        payload: { locale_code, version: nextVersion, completeness_ratio: workspace.completeness.ratio },
      });
      return { ok: true, command, refreshed: await refreshedOwnerLanguages(ctx, locale_code) };
    }
    case 'sync_platform_translation_catalog': {
      const count = await syncCanonicalCatalogInternal(ctx.user.id);
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_translation_catalog',
        entityId: 'canonical',
        action: AUDIT_ACTIONS.PLATFORM_TRANSLATION_CATALOG_SYNCED,
        payload: { key_count: count },
      });
      return { ok: true, command, refreshed: await refreshedOwnerLanguages(ctx, String(payload.locale_code ?? 'en')) };
    }
    default:
      throw badRequest(`Unsupported localization command: ${command}`);
  }
}
