import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { buildAccountSecurityAggregate } from '../account-security/account-security.service.js';
import { buildUserLocalizationAggregate } from '../platform-localization/platform-localization.service.js';
import type { AccountSecurityAggregate, LocalizationAggregate } from '../../types/api.js';

function fallbackSlices(ctx: RequestContext): {
  account_security: AccountSecurityAggregate;
  localization: LocalizationAggregate;
} {
  return {
    account_security: {
      primary_login_email: ctx.user.email,
      primary_email_verified: Boolean(ctx.user.emailVerified),
      additional_login_email: null,
      additional_status: null,
      additional_pending_email: null,
      allowed_actions: ['request_additional_login_email'],
      password_indicator: '••••••••••••',
      password_reveal_forbidden: true,
    },
    localization: {
      country: {
        code: null,
        options: [],
        pack_status: null,
        legal_jurisdiction_note:
          'Country is owned by Country Pack. Changing a UI preference does not silently change tax jurisdiction.',
      },
      language: {
        current: ctx.user.uiLanguage ?? 'en',
        options: [
          { locale: 'en', name: 'English', direction: 'ltr' },
          { locale: 'he', name: 'עברית', direction: 'rtl' },
        ],
      },
      timezone: {
        current: 'Asia/Jerusalem',
        options: [{ value: 'Asia/Jerusalem', label: 'Asia/Jerusalem' }, { value: 'UTC', label: 'UTC' }],
        historical_note: 'Does not rewrite stored timestamps.',
      },
      date_format: {
        current: 'DD/MM/YYYY',
        options: [
          { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
          { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
          { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
        ],
      },
      display_currency: {
        current: 'ILS',
        options: [
          { code: 'ILS', label: 'ILS — ₪ Israeli New Shekel', symbol: '₪' },
          { code: 'USD', label: 'USD — $ United States Dollar', symbol: '$' },
          { code: 'EUR', label: 'EUR — € Euro', symbol: '€' },
        ],
        accounting_base_note:
          'Accounting Base remains the financial source of truth. Display currency does not convert invoices, rewrite entries, or change tax.',
      },
    },
  };
}

export async function loadSessionPreferenceSlices(
  ctx: RequestContext,
): Promise<{ account_security: AccountSecurityAggregate; localization: LocalizationAggregate }> {
  try {
  const [{ data: userRow }, { data: orgRow }, { data: countryRows }, countrySettings] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('timezone, date_format, display_currency_code, ui_language')
      .eq('id', ctx.user.id)
      .maybeSingle(),
    ctx.organizationId
      ? supabaseAdmin
          .from('organizations')
          .select('timezone, country_code')
          .eq('id', ctx.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('countries').select('code, name, status').eq('status', 'active').order('code'),
    ctx.organizationId
      ? supabaseAdmin
          .from('organization_country_settings')
          .select('settings_status, country_code')
          .eq('organization_id', ctx.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const orgCountryCode =
    (typeof orgRow?.country_code === 'string' && orgRow.country_code) ||
    (typeof countrySettings?.data?.country_code === 'string' && countrySettings.data.country_code) ||
    null;
  const countryOptions = ((countryRows ?? []) as Array<{ code: string; name: string }>).map((row) => ({
    code: row.code,
    label: row.name,
  }));
  if (orgCountryCode && !countryOptions.some((row) => row.code === orgCountryCode)) {
    countryOptions.unshift({ code: orgCountryCode, label: orgCountryCode });
  }

  const [account_security, localization] = await Promise.all([
    buildAccountSecurityAggregate(ctx, Boolean(ctx.user.emailVerified)),
    buildUserLocalizationAggregate(ctx, {
      timezone: typeof userRow?.timezone === 'string' ? userRow.timezone : null,
      dateFormat: typeof userRow?.date_format === 'string' ? userRow.date_format : null,
      displayCurrencyCode: typeof userRow?.display_currency_code === 'string' ? userRow.display_currency_code : null,
      uiLanguage: ctx.user.uiLanguage ?? (typeof userRow?.ui_language === 'string' ? userRow.ui_language : 'en'),
      orgTimezone: typeof orgRow?.timezone === 'string' ? orgRow.timezone : null,
      orgCountryCode,
      countryOptions,
      countryPackStatus: typeof countrySettings?.data?.settings_status === 'string'
        ? countrySettings.data.settings_status
        : null,
    }),
  ]);

  return { account_security, localization };
  } catch {
    return fallbackSlices(ctx);
  }
}
