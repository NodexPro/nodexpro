/** Tenant module code stays tax-advisory. Public SPA path is Business Setup. */
export const TAX_ADVISORY_MODULE_CODE = 'tax-advisory';
export const BUSINESS_SETUP_BASE_PATH = '/m/business-setup';
export const LEGACY_TAX_ADVISORY_BASE_PATH = '/m/tax-advisory';

export function businessSetupHomePath(): string {
  return BUSINESS_SETUP_BASE_PATH;
}

export function businessSetupClientPath(clientId: string): string {
  return `${BUSINESS_SETUP_BASE_PATH}/clients/${clientId}`;
}

export function isBusinessSetupPath(pathname: string): boolean {
  return pathname === BUSINESS_SETUP_BASE_PATH || pathname.startsWith(`${BUSINESS_SETUP_BASE_PATH}/`);
}

export function isTaxAdvisoryModulePath(pathname: string): boolean {
  return (
    isBusinessSetupPath(pathname) ||
    pathname === LEGACY_TAX_ADVISORY_BASE_PATH ||
    pathname.startsWith(`${LEGACY_TAX_ADVISORY_BASE_PATH}/`)
  );
}

export function inferTaxAdvisoryModuleCodeFromPath(pathname: string): typeof TAX_ADVISORY_MODULE_CODE | null {
  return isTaxAdvisoryModulePath(pathname) ? TAX_ADVISORY_MODULE_CODE : null;
}

/** Map legacy /m/tax-advisory/* URLs onto /m/business-setup/*. */
export function rewriteLegacyTaxAdvisoryPath(pathname: string): string | null {
  if (pathname === LEGACY_TAX_ADVISORY_BASE_PATH || pathname === `${LEGACY_TAX_ADVISORY_BASE_PATH}/`) {
    return BUSINESS_SETUP_BASE_PATH;
  }
  if (!pathname.startsWith(`${LEGACY_TAX_ADVISORY_BASE_PATH}/`)) return null;
  return `${BUSINESS_SETUP_BASE_PATH}${pathname.slice(LEGACY_TAX_ADVISORY_BASE_PATH.length)}`;
}
