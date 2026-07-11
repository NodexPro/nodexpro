/**
 * Owner Legal Value version — active ruleset resolution from existing Country Pack truth.
 * Reuses country_packs + country_pack_rulesets; no new resolver service.
 */
function isRulesetEffectiveOnDate(ruleset, date) {
    if (String(ruleset.status ?? '') !== 'active')
        return false;
    const from = String(ruleset.effective_from ?? '');
    if (!from || from > date)
        return false;
    const to = ruleset.effective_to == null ? null : String(ruleset.effective_to);
    return to == null || to >= date;
}
function buildRulesetLabel(params) {
    const packPart = params.packName.trim() || params.countryName.trim() || 'Country Pack';
    const codePart = params.rulesetCode.trim();
    const versionPart = params.rulesetVersion.trim();
    if (codePart && versionPart)
        return `${packPart} — ${codePart} v${versionPart}`;
    if (codePart)
        return `${packPart} — ${codePart}`;
    return packPart;
}
export function resolveOwnerLegalValueRulesetContextFromTables(params) {
    const countryCode = params.countryCode.trim().toUpperCase();
    const date = params.effectiveDate.trim() || new Date().toISOString().slice(0, 10);
    if (!countryCode)
        return null;
    const country = (params.countries ?? []).find((row) => String(row.code ?? '').toUpperCase() === countryCode) ?? null;
    const countryName = String(country?.name ?? countryCode);
    const enabledPacks = (params.countryPacks ?? []).filter((pack) => String(pack.country_code ?? '').toUpperCase() === countryCode && String(pack.status ?? '') === 'enabled');
    for (const pack of enabledPacks) {
        const packId = String(pack.id ?? '');
        if (!packId)
            continue;
        const candidates = (params.rulesets ?? [])
            .filter((ruleset) => String(ruleset.country_pack_id ?? '') === packId && isRulesetEffectiveOnDate(ruleset, date))
            .sort((a, b) => String(b.effective_from ?? '').localeCompare(String(a.effective_from ?? '')));
        const ruleset = candidates[0];
        if (!ruleset?.id)
            continue;
        const rulesetCode = String(ruleset.ruleset_code ?? '');
        const rulesetVersion = String(ruleset.ruleset_version ?? '');
        return {
            country_code: countryCode,
            country_name: countryName,
            country_pack_id: packId,
            country_pack_name: String(pack.name ?? packId),
            active_ruleset_id: String(ruleset.id),
            ruleset_code: rulesetCode,
            ruleset_version: rulesetVersion,
            ruleset_label: buildRulesetLabel({
                countryName,
                packName: String(pack.name ?? ''),
                rulesetCode,
                rulesetVersion,
            }),
        };
    }
    return null;
}
export function ownerLegalValueRulesetMissingMessage(countryCode) {
    return `No active Country Pack Ruleset exists for ${countryCode}.`;
}
export function buildOwnerLegalValueRulesetLabel(params) {
    return buildRulesetLabel(params);
}
