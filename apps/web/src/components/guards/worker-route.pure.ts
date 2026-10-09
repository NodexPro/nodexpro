/**
 * UX route guard. Security remains on the API.
 * Office shells are not reduced. Worker and closed shells may open only backend navigation,
 * plus an already-authorized client or document card.
 */

export type NavigationPath = { path: string };

const OFFICE_ADMIN_EXACT = new Set([
  '/dashboard',
  '/settings',
  '/users-roles',
  '/billing',
  '/clients',
  '/documents',
]);

export function workerMayOpenPath(input: {
  shellProfile: string | null | undefined;
  pathname: string;
  availableNavigation: NavigationPath[] | null | undefined;
}): boolean {
  const profile = String(input.shellProfile ?? '').trim();
  if (profile === 'closed') return false;
  if (profile !== 'worker') return true;
  if (!Array.isArray(input.availableNavigation)) return false;
  const path = (input.pathname || '/').replace(/\/+$/, '') || '/';
  if (path.startsWith('/clients/') || path.startsWith('/documents/')) return true;
  if (OFFICE_ADMIN_EXACT.has(path)) {
    return input.availableNavigation.some((item) => item.path === path);
  }
  return input.availableNavigation.some(
    (item) => path === item.path || path.startsWith(`${item.path}/`),
  );
}
