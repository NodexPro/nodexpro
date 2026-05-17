export function resolveIncomeIssuerBusinessDisplay(input) {
    if (input.acting_mode === 'self') {
        const profile = input.orgIssuerProfile;
        if (!profile)
            return 'Office';
        return profile.legal_name?.trim() || profile.display_name?.trim() || 'Office';
    }
    const client = input.client;
    if (!client)
        return 'Client';
    return client.legal_name?.trim() || client.display_name?.trim() || 'Client';
}
