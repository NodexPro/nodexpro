const registry = new Map();
export function registerDashboardProvider(provider) {
    registry.set(provider.code, { provider });
}
export function getDashboardProviders() {
    return [...registry.values()]
        .map((e) => e.provider)
        .sort((a, b) => a.code.localeCompare(b.code));
}
export function clearDashboardProvidersForTestOnly() {
    registry.clear();
}
