/**
 * Organization settings service.
 * Owner-only edit. Multi-tenant isolation. Sensitive fields (bank) only for owner.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AppError, forbidden, badRequest, notFound } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import * as legalIdentityService from '../trial/legal-identity.service.js';
import * as trialService from '../trial/trial.service.js';
import * as fileAccess from '../file-access/file-access.service.js';
import { resolveActiveRulesetByDate } from '../country-pack/ruleset.service.js';
import { syncIncomeIssuerProfileFromOrganization } from '../income/income-issuer-profile-sync.service.js';
const LEGAL_ENTITY_TYPES = ['exempt_dealer', 'registered_dealer', 'company', 'other_corporation', 'other'];
const LEGAL_ENTITY_TYPE_TO_LABEL_KEY = {
    exempt_dealer: 'settings.legalIdLabel.exemptDealer',
    registered_dealer: 'settings.legalIdLabel.registeredDealer',
    company: 'settings.legalIdLabel.company',
    other_corporation: 'settings.legalIdLabel.otherCorporation',
    other: 'settings.legalIdLabel.other',
};
const TRIAL_STATUS_TO_LABEL_KEY = {
    trialing: 'settings.ownerIdentity.trialActiveUntil',
    trial_expired: 'settings.ownerIdentity.trialExpired',
    converted: 'settings.ownerIdentity.trialConverted',
    blocked: 'settings.ownerIdentity.trialBlocked',
    not_started: 'settings.ownerIdentity.trialNotStarted',
    none: 'settings.ownerIdentity.trialNotStarted',
};
function getLegalIdLabelKey(legalEntityType) {
    if (!legalEntityType)
        return 'settings.legalIdLabel.generic';
    return LEGAL_ENTITY_TYPE_TO_LABEL_KEY[legalEntityType] ?? 'settings.legalIdLabel.generic';
}
/** If `countries` has at least one row, PATCH must use a registered `code`. */
async function assertCountryCodeRegisteredWhenRegistryPopulated(code) {
    const cc = code.trim().toUpperCase().slice(0, 2);
    if (cc.length !== 2)
        throw badRequest('Country must be a 2-letter code.', 'INVALID_COUNTRY_CODE');
    const { data: row, error } = await supabaseAdmin.from('countries').select('code').eq('code', cc).maybeSingle();
    if (error)
        throw error;
    if (row)
        return;
    const { data: sample, error: sampleErr } = await supabaseAdmin.from('countries').select('code').limit(1);
    if (sampleErr)
        throw sampleErr;
    if (!sample?.length)
        return;
    throw badRequest('Country code is not registered in the platform country registry. Choose a registered country or add it via platform governance.', 'COUNTRY_NOT_REGISTERED');
}
async function getCountryRegistryWarningForDisplay(code) {
    if (!code || typeof code !== 'string')
        return null;
    const cc = code.trim().toUpperCase().slice(0, 2);
    if (cc.length !== 2)
        return null;
    const { data: row, error } = await supabaseAdmin.from('countries').select('code').eq('code', cc).maybeSingle();
    if (error)
        return null;
    if (row)
        return null;
    const { data: sample, error: sampleErr } = await supabaseAdmin.from('countries').select('code').limit(1);
    if (sampleErr || !sample?.length)
        return null;
    return 'This country code is not in the platform country registry. Country Pack eligibility may be limited until it is registered.';
}
async function autoConfigureOrganizationCountrySettings(organizationId, countryCode) {
    const cc = countryCode.trim().toUpperCase();
    const { data: packs, error: packsErr } = await supabaseAdmin
        .from('country_packs')
        .select('id, pack_code, status')
        .eq('country_code', cc);
    if (packsErr) {
        throw new AppError(500, `Failed to load country packs for ${cc}.`, 'COUNTRY_PACK_QUERY_FAILED');
    }
    if (!packs?.length) {
        throw badRequest(`No country pack found for country ${cc}.`, 'COUNTRY_PACK_NOT_FOUND');
    }
    const activeEligiblePacks = packs.filter((p) => {
        const s = String(p.status ?? '').trim().toLowerCase();
        return s === 'enabled' || s === 'active';
    });
    const candidatePacks = activeEligiblePacks.length ? activeEligiblePacks : packs;
    const preferredPack = (cc === 'IL'
        ? candidatePacks.find((p) => String(p.pack_code ?? '').trim() === 'israel_base_pack')
        : null) ?? candidatePacks[0];
    const packId = String(preferredPack.id);
    const packCode = String(preferredPack.pack_code ?? '');
    const today = new Date().toISOString().slice(0, 10);
    let rulesetId = '';
    let rulesetCode = '';
    let activeForDate = null;
    try {
        activeForDate = await resolveActiveRulesetByDate(packId, today);
    }
    catch (e) {
        if (e instanceof AppError) {
            // If resolver detects overlap/inconsistency, keep flow resilient and choose best available ruleset below.
            activeForDate = null;
        }
        else {
            throw new AppError(500, `Failed to resolve active ruleset for pack ${packCode}.`, 'RULESET_RESOLVE_FAILED');
        }
    }
    if (activeForDate) {
        rulesetId = activeForDate.id;
        rulesetCode = activeForDate.ruleset_code;
    }
    else {
        const { data: latestRows, error: latestErr } = await supabaseAdmin
            .from('country_pack_rulesets')
            .select('id, ruleset_code, status')
            .eq('country_pack_id', packId)
            .order('effective_from', { ascending: false })
            .limit(10);
        if (latestErr) {
            throw new AppError(500, `Failed to load rulesets for pack ${packCode}.`, 'RULESET_QUERY_FAILED');
        }
        const latest = (latestRows ?? []).find((r) => String(r.status ?? '').trim().toLowerCase() === 'active') ??
            (latestRows ?? [])[0] ??
            null;
        if (!latest) {
            throw badRequest(`No ruleset found for country pack ${packCode}.`, 'RULESET_NOT_FOUND');
        }
        rulesetId = String(latest.id);
        rulesetCode = String(latest.ruleset_code ?? '');
    }
    const { error: upsertErr } = await supabaseAdmin.from('organization_country_settings').upsert({
        organization_id: organizationId,
        country_code: cc,
        active_country_pack_id: packId,
        active_ruleset_id: rulesetId,
        settings_status: 'configured',
        updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
    if (upsertErr) {
        throw new AppError(500, `Failed to save organization country settings for ${organizationId}.`, 'ORGANIZATION_COUNTRY_SETTINGS_UPSERT_FAILED');
    }
    return {
        activePackCode: packCode,
        activeRulesetCode: rulesetCode,
    };
}
function getTrialStatusDisplay(trialStatus, endsAt) {
    if (!trialStatus)
        return { labelKey: 'settings.ownerIdentity.trialNotStarted', value: null };
    const labelKey = TRIAL_STATUS_TO_LABEL_KEY[trialStatus] ?? trialStatus;
    if (trialStatus === 'trialing' && endsAt) {
        const d = new Date(endsAt);
        const formatted = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        return { labelKey, value: formatted };
    }
    return { labelKey, value: null };
}
async function isOwner(ctx, orgId) {
    const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('owner_user_id')
        .eq('id', orgId)
        .single();
    return org?.owner_user_id === ctx.user.id;
}
export async function getOrganizationSettings(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    const owner = await isOwner(ctx, orgId);
    const perms = ctx.membership?.permissions ?? [];
    const canEditSettings = owner && (perms.includes('settings:write') || perms.includes('access_settings'));
    const ownerIdentity = await legalIdentityService.getOwnerIdentityForSettings(orgId);
    const trial = await trialService.getTrialState(orgId);
    const trialDisplay = getTrialStatusDisplay(trial.trialStatus, trial.endsAt);
    const result = {
        capabilities: {
            canEditSettings,
            showBankDetails: owner,
            showOwnerIdentity: !!ownerIdentity,
        },
        legalEntityTypeToLabelKey: { ...LEGAL_ENTITY_TYPE_TO_LABEL_KEY },
    };
    if (ownerIdentity) {
        result.ownerIdentity = {
            masked: ownerIdentity.masked,
            isLocked: ownerIdentity.isLocked,
            lockedAt: ownerIdentity.lockedAt,
            legalIdLabelKey: ownerIdentity.legalIdentityType === 'tz' ? 'settings.legalIdLabel.teudatZehut' : 'settings.legalIdLabel.generic',
            trialStatusCode: trial.trialStatus,
            trialStatusLabelKey: trialDisplay.labelKey,
            trialStatusValue: trialDisplay.value,
            trialEndsAt: trial.endsAt ?? null,
            daysRemaining: trial.daysRemaining ?? null,
        };
    }
    const { data: org } = await supabaseAdmin.from('organizations').select('name, legal_name, country_code').eq('id', orgId).single();
    const { data: settings } = await supabaseAdmin
        .from('organization_settings')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();
    const s = settings;
    const orgRow = org;
    const profileCountry = orgRow?.country_code ?? s?.country ?? null;
    result.profile = {
        organizationName: s?.organization_name ?? orgRow?.name ?? null,
        legalEntityType: s?.legal_entity_type ?? null,
        legalIdNumber: s?.legal_id_number ?? null,
        legalIdLabelKey: getLegalIdLabelKey(s?.legal_entity_type ?? null),
        addressLine1: s?.address_line_1 ?? null,
        addressLine2: s?.address_line_2 ?? null,
        city: s?.city ?? null,
        postalCode: s?.postal_code ?? null,
        country: profileCountry,
        countryWarning: await getCountryRegistryWarningForDisplay(profileCountry),
        phone: s?.phone ?? null,
        website: s?.website ?? null,
        logoFileAssetId: s?.logo_file_asset_id ?? null,
    };
    result.documentIdentity = {
        displayNameOnDocuments: s?.display_name_on_documents ?? null,
        displayPhoneOnDocuments: s?.display_phone_on_documents === false ? false : true,
        displayWebsiteOnDocuments: s?.display_website_on_documents === false ? false : true,
        displayAddressOnDocuments: s?.display_address_on_documents === false ? false : true,
        documentFooterNote: s?.document_footer_note?.trim() || null,
    };
    result.signature = {
        signatureText: s?.signature_text ?? null,
        signatureImageFileAssetId: s?.signature_image_file_asset_id ?? null,
    };
    if (owner) {
        result.bankDetails = {
            bankAccountHolder: s?.bank_account_holder ?? null,
            bankName: s?.bank_name ?? null,
            bankBranch: s?.bank_branch ?? null,
            bankAccountNumber: s?.bank_account_number ?? null,
            iban: s?.iban ?? null,
            swift: s?.swift ?? null,
            displayBankDetailsOnDocuments: s?.display_bank_details_on_documents === true,
        };
    }
    const { data: ocs } = await supabaseAdmin
        .from('organization_country_settings')
        .select('active_country_pack_id, active_ruleset_id')
        .eq('organization_id', orgId)
        .maybeSingle();
    const activePackId = String(ocs?.active_country_pack_id ?? '');
    const activeRulesetId = String(ocs?.active_ruleset_id ?? '');
    let activePackCode = null;
    let activeRulesetCode = null;
    if (activePackId) {
        const { data: p } = await supabaseAdmin.from('country_packs').select('pack_code').eq('id', activePackId).maybeSingle();
        activePackCode = p?.pack_code ? String(p.pack_code) : null;
    }
    if (activeRulesetId) {
        const { data: r } = await supabaseAdmin
            .from('country_pack_rulesets')
            .select('ruleset_code, ruleset_version')
            .eq('id', activeRulesetId)
            .maybeSingle();
        if (r?.ruleset_code) {
            activeRulesetCode = r.ruleset_version
                ? `${String(r.ruleset_code)}.${String(r.ruleset_version)}`
                : String(r.ruleset_code);
        }
    }
    result.country_configuration = {
        status: activePackId && activeRulesetId ? 'configured' : 'not_configured',
        active_pack: activePackCode,
        active_ruleset: activeRulesetCode,
    };
    return result;
}
/**
 * Secure file open for settings logo/signature. Delegates to shared file-access service.
 */
export async function getSettingsFileOpenUrl(ctx, orgId, fileAssetId) {
    const result = await fileAccess.getSecureOpenUrlForOrgFile(ctx, orgId, fileAssetId, 'settings');
    return { url: result.url, expiresIn: result.expiresIn };
}
function sanitizeWebsite(url) {
    if (url == null || typeof url !== 'string')
        return null;
    const t = url.trim();
    if (!t)
        return null;
    if (!/^https?:\/\//i.test(t))
        return `https://${t}`;
    return t;
}
function sanitizePhone(phone) {
    if (phone == null || typeof phone !== 'string')
        return null;
    const t = phone.trim();
    return t || null;
}
export async function patchOrganizationSettings(ctx, orgId, body) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    if (!(await isOwner(ctx, orgId)))
        throw forbidden('Only the organization owner can edit settings');
    if (body.legalEntityType != null && body.legalEntityType !== '' && !LEGAL_ENTITY_TYPES.includes(body.legalEntityType)) {
        throw badRequest('Invalid legal_entity_type');
    }
    if (body.logoFileAssetId != null && body.logoFileAssetId !== '') {
        const logoFile = await fileAccess.validateOrgFileOwnership(ctx, orgId, body.logoFileAssetId);
        fileAccess.assertFileAllowedForSettingsImage(logoFile);
    }
    if (body.signatureImageFileAssetId != null && body.signatureImageFileAssetId !== '') {
        const sigFile = await fileAccess.validateOrgFileOwnership(ctx, orgId, body.signatureImageFileAssetId);
        fileAccess.assertFileAllowedForSettingsImage(sigFile);
    }
    const { data: orgBefore } = await supabaseAdmin.from('organizations').select('country_code').eq('id', orgId).single();
    if (!orgBefore)
        throw notFound('Organization not found');
    const previousOrgCountry = String(orgBefore.country_code).trim().toUpperCase().slice(0, 2);
    let effectiveCountryCode = previousOrgCountry;
    if (body.country !== undefined) {
        const raw = body.country?.trim() ?? '';
        if (!raw)
            throw badRequest('Country is required.', 'INVALID_COUNTRY_CODE');
        const cc = raw.slice(0, 2).toUpperCase();
        await assertCountryCodeRegisteredWhenRegistryPopulated(cc);
        if (cc !== previousOrgCountry) {
            const { error: orgErr } = await supabaseAdmin
                .from('organizations')
                .update({ country_code: cc, updated_at: new Date().toISOString() })
                .eq('id', orgId);
            if (orgErr)
                throw orgErr;
            await writeAudit({
                organizationId: orgId,
                actorUserId: ctx.user.id,
                entityType: 'organization',
                entityId: orgId,
                action: AUDIT_ACTIONS.ORGANIZATION_UPDATED,
                payload: { field: 'country_code', from: previousOrgCountry, to: cc },
            });
        }
        effectiveCountryCode = cc;
    }
    const { data: ocsBeforeCfg } = await supabaseAdmin
        .from('organization_country_settings')
        .select('country_code, settings_status, active_country_pack_id, active_ruleset_id')
        .eq('organization_id', orgId)
        .maybeSingle();
    const ocs = ocsBeforeCfg;
    const hasConfiguredBinding = !!ocs &&
        String(ocs.settings_status ?? '').toLowerCase() === 'configured' &&
        !!ocs.active_country_pack_id &&
        !!ocs.active_ruleset_id &&
        String(ocs.country_code ?? '').trim().toUpperCase().slice(0, 2) === effectiveCountryCode;
    const shouldAutoConfigureCountrySettings = effectiveCountryCode.length === 2 && (body.country !== undefined || !hasConfiguredBinding);
    if (shouldAutoConfigureCountrySettings) {
        const autoCfg = await autoConfigureOrganizationCountrySettings(orgId, effectiveCountryCode);
        await writeAudit({
            organizationId: orgId,
            actorUserId: ctx.user.id,
            entityType: 'organization_country_settings',
            entityId: orgId,
            action: AUDIT_ACTIONS.ORGANIZATION_COUNTRY_SETTINGS_UPDATED,
            payload: {
                mode: body.country !== undefined ? 'automatic_on_settings_save_country_payload' : 'automatic_on_settings_save_backfill',
                country_code: effectiveCountryCode,
                active_pack: autoCfg.activePackCode,
                active_ruleset: autoCfg.activeRulesetCode,
            },
        });
    }
    const { data: existing } = await supabaseAdmin.from('organization_settings').select('*').eq('organization_id', orgId).maybeSingle();
    const base = (existing ?? { organization_id: orgId });
    if (body.organizationName !== undefined)
        base.organization_name = body.organizationName?.trim() || null;
    if (body.legalEntityType !== undefined)
        base.legal_entity_type = body.legalEntityType?.trim() || null;
    if (body.legalIdNumber !== undefined)
        base.legal_id_number = body.legalIdNumber?.trim() || null;
    if (body.addressLine1 !== undefined)
        base.address_line_1 = body.addressLine1?.trim() || null;
    if (body.addressLine2 !== undefined)
        base.address_line_2 = body.addressLine2?.trim() || null;
    if (body.city !== undefined)
        base.city = body.city?.trim() || null;
    if (body.postalCode !== undefined)
        base.postal_code = body.postalCode?.trim() || null;
    if (body.phone !== undefined)
        base.phone = sanitizePhone(body.phone);
    if (body.website !== undefined)
        base.website = sanitizeWebsite(body.website);
    if (body.logoFileAssetId !== undefined)
        base.logo_file_asset_id = body.logoFileAssetId || null;
    if (body.displayNameOnDocuments !== undefined)
        base.display_name_on_documents = body.displayNameOnDocuments?.trim() || null;
    if (body.displayPhoneOnDocuments !== undefined)
        base.display_phone_on_documents = body.displayPhoneOnDocuments;
    if (body.displayWebsiteOnDocuments !== undefined)
        base.display_website_on_documents = body.displayWebsiteOnDocuments;
    if (body.displayAddressOnDocuments !== undefined)
        base.display_address_on_documents = body.displayAddressOnDocuments;
    if (body.documentFooterNote !== undefined)
        base.document_footer_note = body.documentFooterNote?.trim() || null;
    if (body.signatureText !== undefined)
        base.signature_text = body.signatureText?.trim() || null;
    if (body.signatureImageFileAssetId !== undefined)
        base.signature_image_file_asset_id = body.signatureImageFileAssetId || null;
    if (body.bankAccountHolder !== undefined)
        base.bank_account_holder = body.bankAccountHolder?.trim() || null;
    if (body.bankName !== undefined)
        base.bank_name = body.bankName?.trim() || null;
    if (body.bankBranch !== undefined)
        base.bank_branch = body.bankBranch?.trim() || null;
    if (body.bankAccountNumber !== undefined)
        base.bank_account_number = body.bankAccountNumber?.trim() || null;
    if (body.iban !== undefined)
        base.iban = body.iban?.trim() || null;
    if (body.swift !== undefined)
        base.swift = body.swift?.trim() || null;
    if (body.displayBankDetailsOnDocuments !== undefined)
        base.display_bank_details_on_documents = body.displayBankDetailsOnDocuments;
    base.organization_id = orgId;
    base.updated_at = new Date().toISOString();
    base.country = effectiveCountryCode;
    const { error: settingsUpsertErr } = await supabaseAdmin
        .from('organization_settings')
        .upsert(base, { onConflict: 'organization_id' });
    if (settingsUpsertErr) {
        throw new AppError(500, 'Failed to save organization settings.', 'ORGANIZATION_SETTINGS_UPSERT_FAILED');
    }
    if (body.logoFileAssetId !== undefined) {
        await writeAudit({
            organizationId: orgId,
            actorUserId: ctx.user.id,
            entityType: 'organization_settings',
            entityId: orgId,
            action: AUDIT_ACTIONS.ORGANIZATION_SETTINGS_LOGO_UPDATED,
            payload: { logoFileAssetId: base.logo_file_asset_id ?? null },
        });
    }
    if (body.signatureImageFileAssetId !== undefined) {
        await writeAudit({
            organizationId: orgId,
            actorUserId: ctx.user.id,
            entityType: 'organization_settings',
            entityId: orgId,
            action: AUDIT_ACTIONS.ORGANIZATION_SETTINGS_SIGNATURE_UPDATED,
            payload: { signatureImageFileAssetId: base.signature_image_file_asset_id ?? null },
        });
    }
    if (body.organizationName !== undefined && body.organizationName?.trim()) {
        await supabaseAdmin.from('organizations').update({ name: body.organizationName.trim(), updated_at: new Date().toISOString() }).eq('id', orgId);
    }
    await syncIncomeIssuerProfileFromOrganization(orgId, { actorUserId: ctx.user.id, audit: true });
    return getOrganizationSettings(ctx, orgId);
}
