/**
 * Presentation-only commercial copy keys for the Modules showcase.
 * Does not invent modules, prices, entitlements, or actions.
 * Benefits are keyed by the authorized aggregate's module code after capability review.
 */

export type ModuleShowcaseCatalog = 'clientOperations' | 'docflow' | 'invoice' | 'fallback';

export type ModuleShowcaseCopy = {
  catalog: ModuleShowcaseCatalog;
  benefitCount: number;
};

const KNOWN: Readonly<Record<string, ModuleShowcaseCopy>> = {
  'client-operations': { catalog: 'clientOperations', benefitCount: 6 },
  docflow: { catalog: 'docflow', benefitCount: 4 },
  invoice: { catalog: 'invoice', benefitCount: 4 },
  income: { catalog: 'invoice', benefitCount: 4 },
};

export function resolveModuleShowcase(moduleCode: string): ModuleShowcaseCopy {
  return KNOWN[String(moduleCode ?? '').trim()] ?? { catalog: 'fallback', benefitCount: 3 };
}

export function moduleShowcaseLeadKey(moduleCode: string): string {
  return `modules.showcase.${resolveModuleShowcase(moduleCode).catalog}.lead`;
}

export function moduleShowcaseHeadlineKey(moduleCode: string): string {
  return `modules.showcase.${resolveModuleShowcase(moduleCode).catalog}.headline`;
}

export function moduleShowcaseClosingKey(moduleCode: string): string {
  return `modules.showcase.${resolveModuleShowcase(moduleCode).catalog}.closing`;
}

export function moduleShowcaseBenefitKeys(moduleCode: string): string[] {
  const copy = resolveModuleShowcase(moduleCode);
  return Array.from({ length: copy.benefitCount }, (_, index) => {
    return `modules.showcase.${copy.catalog}.benefits.${index + 1}`;
  });
}
