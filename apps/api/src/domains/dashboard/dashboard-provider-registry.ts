import type { DashboardProvider } from './dashboard-provider.js';

type ProviderEntry = {
  provider: DashboardProvider;
};

const registry = new Map<string, ProviderEntry>();

export function registerDashboardProvider(provider: DashboardProvider): void {
  registry.set(provider.code, { provider });
}

export function getDashboardProviders(): DashboardProvider[] {
  return [...registry.values()]
    .map((e) => e.provider)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function clearDashboardProvidersForTestOnly(): void {
  registry.clear();
}

