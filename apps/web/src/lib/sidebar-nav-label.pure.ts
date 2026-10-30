/** Presentation mapping: session nav path → existing i18n key. Fallback is the session label. */

const EXACT_NAV_I18N_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/settings': 'nav.settings',
  '/users-roles': 'nav.usersRoles',
  '/clients': 'nav.clients',
  '/documents': 'nav.documents',
  '/modules': 'nav.modules',
  '/billing': 'nav.billing',
  '/m/client-operations': 'nav.clientOperations',
  '/m/income': 'nav.income',
  '/m/docflow': 'nav.docflow',
  '/m/docflow/invites': 'nav.docflowInvites',
  '/m/docflow/review': 'nav.docflowReview',
  '/m/docflow/messenger': 'nav.docflowMessenger',
  '/work-engine': 'nav.workEngine',
  '/work-engine/queue': 'nav.workEngine',
};

export function sidebarNavI18nKey(path: string): string | null {
  const p = String(path ?? '').split('?')[0] ?? '';
  if (EXACT_NAV_I18N_KEYS[p]) return EXACT_NAV_I18N_KEYS[p];
  if (p.startsWith('/m/client-operations')) return 'nav.clientOperations';
  if (p.startsWith('/m/income')) return 'nav.income';
  if (p.startsWith('/m/docflow')) return 'nav.docflow';
  if (p.startsWith('/work-engine')) return 'nav.workEngine';
  return null;
}

export function sidebarNavLabel(path: string, fallback: string, t: (key: string) => string): string {
  const key = sidebarNavI18nKey(path);
  if (!key) return fallback;
  const translated = t(key);
  if (!translated || translated === key) return fallback;
  return translated;
}
