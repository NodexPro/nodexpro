import '../../styles/nx-account-deep-ocean-glass.css';

export const ACCOUNT_DEEP_OCEAN_CLASS = 'nx-account-deep-ocean';

export function withAccountDeepOceanClass(baseClass: string): string {
  return `${baseClass} ${ACCOUNT_DEEP_OCEAN_CLASS}`;
}
