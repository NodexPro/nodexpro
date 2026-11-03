import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { bundledSourceForLocale, CANONICAL_SOURCE_EN } from './canonical-catalog.js';
import {
  DATE_FORMAT_OPTIONS,
  canPublishLanguage,
  isIso4217Code,
  isLocaleCode,
  mergePublishedCatalog,
  moduleCompleteness,
  moduleGroupForKey,
  normalizeCurrencyCode,
  placeholdersMatch,
  publishedCurrencyOptions,
  publishedLanguageOptions,
  snapshotFromEntries,
  timezoneOptions,
  translationCompleteness,
  translationEntryFilterStatus,
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
  'rollback_platform_language',
  'sync_platform_translation_catalog',
]);

let catalogSeeded = false;
let catalogKeysCache: Array<{ key: string; source_en: string; module_group: string }> | null = null;
let languagesCache: LanguageRow[] | null = null;

function invalidateLocalizationCaches(): void {
  catalogSeeded = false;
  catalogKeysCache = null;
  languagesCache = null;
}

function isMissingSnapshotColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const hay = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return hay.includes('snapshot') && (hay.includes('does not exist') || hay.includes('42703') || hay.includes('pgrst204') || hay.includes('schema cache') || hay.includes('column'));
}

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

async function loadLanguages(force = false): Promise<LanguageRow[]> {
  if (!force && languagesCache) return languagesCache;
  const { data, error } = await supabaseAdmin
    .from('platform_languages')
    .select('locale_code, name, direction, status, version, published_at, updated_at')
    .order('locale_code');
  if (error) throw error;
  languagesCache = (data ?? []) as LanguageRow[];
  return languagesCache;
}

async function loadCatalogKeys(force = false): Promise<Array<{ key: string; source_en: string; module_group: string }>> {
  if (!force && catalogKeysCache) return catalogKeysCache;
  const { data, error } = await supabaseAdmin
    .from('platform_translation_keys')
    .select('key, source_en, module_group')
    .order('key');
  if (error) throw error;
  catalogKeysCache = (data ?? []) as Array<{ key: string; source_en: string; module_group: string }>;
  return catalogKeysCache;
}

async function ensureCatalogSeeded(): Promise<void> {
  if (catalogSeeded) return;
  const existing = await loadCatalogKeys();
  if (existing.length >= Object.keys(CANONICAL_SOURCE_EN).length) {
    catalogSeeded = true;
    return;
  }
  await syncCanonicalCatalogInternal(null);
  catalogSeeded = true;
}

async function syncCanonicalCatalogInternal(actorUserId: string | null): Promise<number> {
  const rows = Object.entries(CANONICAL_SOURCE_EN).map(([key, source_en]) => ({
    key,
    source_en,
    module_group: moduleGroupForKey(key),
  }));
  const { error } = await supabaseAdmin.from('platform_translation_keys').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
  const languages = await loadLanguages(true);
  for (const language of languages) {
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from('platform_translation_values')
      .select('key')
      .eq('locale_code', language.locale_code);
    if (existingErr) throw existingErr;
    const have = new Set((existingRows ?? []).map((row) => String(row.key)));
    const source = bundledSourceForLocale(language.locale_code);
    const inserts = rows
      .filter((row) => !have.has(row.key))
      .map((row) => ({
        locale_code: language.locale_code,
        key: row.key,
        value: source[row.key] ?? '',
        status:
          language.status === 'published' && (language.locale_code === 'en' || language.locale_code === 'he')
            ? 'published'
            : 'draft',
        updated_by_user_id: actorUserId,
      }));
    if (inserts.length) {
      const { error: valueErr } = await supabaseAdmin.from('platform_translation_values').insert(inserts);
      if (valueErr) throw valueErr;
    }
  }
  invalidateLocalizationCaches();
  catalogSeeded = true;
  await loadCatalogKeys(true);
  await loadLanguages(true);
  return rows.length;
}

async function loadLatestPublishedSnapshot(locale: string): Promise<Record<string, string> | null> {
  const { data, error } = await supabaseAdmin
    .from('platform_language_versions')
    .select('snapshot, version')
    .eq('locale_code', locale)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSnapshotColumn(error)) return null;
    throw error;
  }
  const snapshot = data?.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

async function insertLanguageVersion(row: Record<string, unknown>): Promise<void> {
  const withSnapshot = await supabaseAdmin.from('platform_language_versions').insert(row);
  if (!withSnapshot.error) return;
  if (!isMissingSnapshotColumn(withSnapshot.error)) throw withSnapshot.error;
  const { snapshot: _ignored, ...withoutSnapshot } = row;
  const fallback = await supabaseAdmin.from('platform_language_versions').insert(withoutSnapshot);
  if (fallback.error) throw fallback.error;
}

async function capturePublishedSnapshotIfMissing(language: LanguageRow): Promise<void> {
  if (language.status !== 'published') return;
  const existingQuery = await supabaseAdmin
    .from('platform_language_versions')
    .select('id, snapshot, version')
    .eq('locale_code', language.locale_code)
    .eq('version', language.version)
    .maybeSingle();
  if (existingQuery.error && isMissingSnapshotColumn(existingQuery.error)) return;
  if (existingQuery.error) throw existingQuery.error;
  const existing = existingQuery.data;
  const currentSnap = existing?.snapshot;
  if (currentSnap && typeof currentSnap === 'object' && !Array.isArray(currentSnap) && Object.keys(currentSnap).length > 0) {
    return;
  }
  const { data } = await supabaseAdmin
    .from('platform_translation_values')
    .select('key, value, status')
    .eq('locale_code', language.locale_code)
    .eq('status', 'published');
  const snapshot = mergePublishedCatalog({
    bundled: bundledSourceForLocale(language.locale_code),
    snapshot: null,
    livePublished: Object.fromEntries(
      (data ?? [])
        .filter((row) => typeof row.key === 'string' && typeof row.value === 'string')
        .map((row) => [String(row.key), String(row.value)]),
    ),
  });
  if (existing?.id) {
    const updated = await supabaseAdmin.from('platform_language_versions').update({ snapshot }).eq('id', existing.id);
    if (updated.error && !isMissingSnapshotColumn(updated.error)) throw updated.error;
    return;
  }
  await insertLanguageVersion({
    locale_code: language.locale_code,
    version: language.version,
    status: 'published',
    completeness_ratio: 1,
    snapshot,
    published_at: language.published_at,
  });
}

async function languageWorkspace(locale: string, preloaded?: { languages?: LanguageRow[] }) {
  await ensureCatalogSeeded();
  const languages = preloaded?.languages ?? (await loadLanguages());
  const language = languages.find((row) => row.locale_code === locale) ?? null;
  if (!language) throw badRequest('Language not found.');
  const keys = await loadCatalogKeys();
  const [{ data: values, error }, versions] = await Promise.all([
    supabaseAdmin.from('platform_translation_values').select('key, value, status, updated_at').eq('locale_code', locale),
    supabaseAdmin
      .from('platform_language_versions')
      .select('version, status, completeness_ratio, published_at, snapshot')
      .eq('locale_code', locale)
      .order('version', { ascending: false })
      .limit(20),
  ]);
  if (error) throw error;
  let versionRows: Array<{
    version?: number;
    status?: string;
    completeness_ratio?: number;
    published_at?: string | null;
    snapshot?: unknown;
  }> = versions.data ?? [];
  if (versions.error) {
    if (!isMissingSnapshotColumn(versions.error)) throw versions.error;
    const fallback = await supabaseAdmin
      .from('platform_language_versions')
      .select('version, status, completeness_ratio, published_at')
      .eq('locale_code', locale)
      .order('version', { ascending: false })
      .limit(20);
    if (fallback.error) throw fallback.error;
    versionRows = fallback.data ?? [];
  }
  const byKey = new Map((values ?? []).map((row) => [row.key as string, row]));
  const entries = keys.map((keyRow) => {
    const current = byKey.get(keyRow.key);
    const value = typeof current?.value === 'string' ? current.value : '';
    const status = typeof current?.status === 'string' ? current.status : 'draft';
    const placeholder_ok = value.trim() ? placeholdersMatch(keyRow.source_en, value) : value.trim() === '';
    return {
      key: keyRow.key,
      module_group: keyRow.module_group,
      source_en: keyRow.source_en,
      value,
      status,
      filter_status: translationEntryFilterStatus({ value, status, placeholder_ok }),
      placeholder_ok,
    };
  });
  const translatedCount = entries.filter((entry) => entry.value.trim().length > 0 && entry.placeholder_ok).length;
  const placeholderFailures = entries.filter((entry) => entry.value.trim().length > 0 && !entry.placeholder_ok).length;
  const completeness = translationCompleteness({ catalogSize: keys.length, translatedCount });
  const groups = [...new Set(entries.map((entry) => entry.module_group))];
  const module_completeness = moduleCompleteness(entries);
  return {
    language,
    entries,
    groups,
    completeness,
    module_completeness,
    versions: versionRows.map((row) => ({
      version: row.version,
      status: row.status,
      completeness_ratio: row.completeness_ratio,
      published_at: row.published_at,
      has_snapshot: Boolean(
        'snapshot' in row &&
          row.snapshot &&
          typeof row.snapshot === 'object' &&
          Object.keys(row.snapshot as object).length,
      ),
    })),
    placeholder_failures: placeholderFailures,
    catalog_size: keys.length,
    translated_count: translatedCount,
    uncovered_application_areas: module_completeness
      .filter((row) => row.missing_count > 0)
      .map((row) => row.module_group),
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
  const workspace = await languageWorkspace(selected, { languages });
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
      'rollback_platform_language',
      'sync_platform_translation_catalog',
    ],
  };
}

export async function loadPublishedTranslationCatalog(locale: string): Promise<Record<string, string>> {
  if (!isLocaleCode(locale)) return {};
  const bundled = bundledSourceForLocale(locale);
  const { data: language } = await supabaseAdmin
    .from('platform_languages')
    .select('locale_code, status')
    .eq('locale_code', locale)
    .maybeSingle();
  if (!language || language.status !== 'published') {
    return { ...bundled };
  }
  const [{ data }, snapshot] = await Promise.all([
    supabaseAdmin
      .from('platform_translation_values')
      .select('key, value, status')
      .eq('locale_code', locale)
      .eq('status', 'published'),
    loadLatestPublishedSnapshot(locale),
  ]);
  const livePublished: Record<string, string> = {};
  for (const row of data ?? []) {
    if (typeof row.key === 'string' && typeof row.value === 'string' && row.value.trim()) {
      livePublished[row.key] = row.value;
    }
  }
  return mergePublishedCatalog({ bundled, snapshot, livePublished });
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
      const languages = await loadLanguages();
      const language = languages.find((row) => row.locale_code === locale_code);
      if (!language) throw badRequest('Language not found.');
      await capturePublishedSnapshotIfMissing(language);
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
      languagesCache = null;
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_TRANSLATION_DRAFT_SAVED,
        payload: { locale_code, updated_keys: upserts.length, published_snapshot_preserved: true },
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
      const snapshot = snapshotFromEntries(workspace.entries);
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
      await insertLanguageVersion({
        locale_code,
        version: nextVersion,
        status: 'published',
        completeness_ratio: workspace.completeness.ratio,
        snapshot,
        published_at: new Date().toISOString(),
        published_by_user_id: ctx.user.id,
      });
      invalidateLocalizationCaches();
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_LANGUAGE_PUBLISHED,
        payload: { locale_code, version: nextVersion, completeness_ratio: workspace.completeness.ratio, snapshot_keys: Object.keys(snapshot).length },
      });
      return { ok: true, command, refreshed: await refreshedOwnerLanguages(ctx, locale_code) };
    }
    case 'rollback_platform_language': {
      const locale_code = String(payload.locale_code ?? '').trim();
      const version = Number(payload.version ?? 0);
      if (!isLocaleCode(locale_code)) throw badRequest('Locale is required.');
      if (!Number.isInteger(version) || version < 1) throw badRequest('Published version is required.');
      const versionQuery = await supabaseAdmin
        .from('platform_language_versions')
        .select('version, snapshot, status')
        .eq('locale_code', locale_code)
        .eq('version', version)
        .maybeSingle();
      if (versionQuery.error && isMissingSnapshotColumn(versionQuery.error)) {
        throw badRequest('This version has no snapshot and cannot be rolled back safely.');
      }
      if (versionQuery.error) throw versionQuery.error;
      const versionRow = versionQuery.data;
      if (!versionRow) throw badRequest('Translation version not found.');
      const snapshotRaw = versionRow.snapshot;
      if (!snapshotRaw || typeof snapshotRaw !== 'object' || Array.isArray(snapshotRaw)) {
        throw badRequest('This version has no snapshot and cannot be rolled back safely.');
      }
      const snapshot = snapshotFromEntries(
        Object.entries(snapshotRaw as Record<string, unknown>).map(([key, value]) => ({
          key,
          value: typeof value === 'string' ? value : '',
        })),
      );
      if (!Object.keys(snapshot).length) {
        throw badRequest('This version has no snapshot and cannot be rolled back safely.');
      }
      const keys = await loadCatalogKeys();
      const allowed = new Set(keys.map((row) => row.key));
      const restores = Object.entries(snapshot)
        .filter(([key]) => allowed.has(key))
        .map(([key, value]) => ({
          locale_code,
          key,
          value,
          status: 'published',
          updated_at: new Date().toISOString(),
          updated_by_user_id: ctx.user.id,
        }));
      if (restores.length) {
        const { error } = await supabaseAdmin
          .from('platform_translation_values')
          .upsert(restores, { onConflict: 'locale_code,key' });
        if (error) throw error;
      }
      const { data: language } = await supabaseAdmin
        .from('platform_languages')
        .select('version')
        .eq('locale_code', locale_code)
        .maybeSingle();
      const nextVersion = Number(language?.version ?? version) + 1;
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
      await insertLanguageVersion({
        locale_code,
        version: nextVersion,
        status: 'published',
        completeness_ratio: translationCompleteness({
          catalogSize: keys.length,
          translatedCount: restores.length,
        }).ratio,
        snapshot,
        published_at: new Date().toISOString(),
        published_by_user_id: ctx.user.id,
      });
      invalidateLocalizationCaches();
      await writeAudit({
        ...auditBase(ctx),
        entityType: 'platform_language',
        entityId: locale_code,
        action: AUDIT_ACTIONS.PLATFORM_LANGUAGE_ROLLED_BACK,
        payload: { locale_code, from_version: version, restored_version: nextVersion, restored_keys: restores.length },
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
