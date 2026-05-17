import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import { TemplateLayout } from '../../templates/template-1/TemplateLayout';
import { ReminderToasts } from '../ReminderToasts';
import { DocflowFloatingWidget } from '../DocflowFloatingWidget';
/** Modules catalog is visible when user can manage billing/modules. Must not depend on enabledModules/trial/purchased. */
function canSeeModulesCatalog(permissions: string[]): boolean {
  return permissions.includes('modules:read') || permissions.includes('subscriptions:read');
}

function SessionLanguageSync() {
  const auth = useAuth();
  const { lang, setLang } = useI18n();

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const next = auth.me.sidebar_account_block?.language_selector?.current_value;
    if ((next === 'en' || next === 'he') && next !== lang) {
      setLang(next);
    }
  }, [auth, lang, setLang]);

  return null;
}

export function AppShell() {
  const auth = useAuth();
  const { setLang } = useI18n();
  const [accountBusy, setAccountBusy] = useState(false);

  if (auth.status !== 'authenticated') return null;
  const { me } = auth;
  let navItems = me.navItems?.length ? me.navItems : buildNavItemsFallback(me.permissions, me.enabledModules);
  if (canSeeModulesCatalog(me.permissions) && !navItems.some((n) => n.path === '/modules')) {
    navItems = [...navItems, { path: '/modules', label: 'Modules', order: 30 }].sort((a, b) => a.order - b.order);
  }

  const fromLegacyNav =
    me.navItems?.filter((n) => n.path.startsWith('/m/')).map((n) => ({ path: n.path, label: n.label, moduleCode: inferModuleCodeFromPath(n.path) })) ?? [];
  const fromEnabledFallback = buildModuleSubnavFromEnabled(me.enabledModules);
  const fromBackendModuleNav = (me.moduleAppNavItems ?? []).map((n) => ({
    path: n.path,
    label: n.label,
    moduleCode: inferModuleCodeFromPath(n.path),
  }));
  const enabledModulesSet = new Set((me.enabledModules ?? []).map((m) => m.toLowerCase()));
  const moduleChildrenRaw = mergeModuleSubnavItems(
    fromBackendModuleNav.length ? fromBackendModuleNav : fromLegacyNav,
    fromEnabledFallback,
  ).filter((item) => !isHiddenModuleItem(item) && isEnabledModuleItem(item, enabledModulesSet));
  const moduleChildren = moduleChildrenRaw.map((c) => ({ to: c.path, label: c.label }));

  const sidebarItems = navItems
    .filter((n) => !n.path.startsWith('/m/'))
    .map((n) =>
      n.path === '/modules' && moduleChildren.length
        ? { to: n.path, label: n.label, children: moduleChildren }
        : { to: n.path, label: n.label },
    );

  const reminderEnabled = me.enabledModules?.includes('client-operations') ?? false;

  return (
    <>
      <SessionLanguageSync />
      <TemplateLayout
        organizations={me.organizations}
        activeOrganizationId={me.activeOrganizationId}
        onSelectOrg={async (id) => {
          setAccountBusy(true);
          try {
            await auth.setActiveOrg(id);
          } finally {
            setAccountBusy(false);
          }
        }}
        user={me.user}
        onSignOut={auth.signOut}
        sidebarItems={sidebarItems}
        sidebarAccountBlock={me.sidebar_account_block}
        accountBusy={accountBusy}
        onSetUiLanguage={async (code) => {
          setAccountBusy(true);
          try {
            const refreshed = await auth.setUiLanguage(code);
            const next = refreshed?.sidebar_account_block.language_selector.current_value;
            if (next === 'en' || next === 'he') setLang(next);
          } finally {
            setAccountBusy(false);
          }
        }}
      >
        <Outlet />
      </TemplateLayout>
      <ReminderToasts enabled={reminderEnabled} />
      <DocflowFloatingWidget />
    </>
  );
}

/** When /me has no moduleAppNavItems yet, show known module links under Modules. */
function buildModuleSubnavFromEnabled(enabled: string[]): { path: string; label: string; moduleCode: string }[] {
  const map: Record<string, { path: string; label: string; moduleCode: string }> = {
    'client-operations': { path: '/m/client-operations', label: 'Nodex לקוחות', moduleCode: 'client-operations' },
    docflow: { path: '/m/docflow/invites', label: 'DocFlow Chat', moduleCode: 'docflow' },
  };
  return (enabled ?? [])
    .filter((c) => c !== 'core')
    .map((c) => map[c] ?? { path: '/modules', label: c, moduleCode: c });
}

function inferModuleCodeFromPath(path: string): string | null {
  if (path.startsWith('/m/core')) return 'core';
  if (path.startsWith('/m/client-operations')) return 'client-operations';
  if (path.startsWith('/m/docflow')) return 'docflow';
  return null;
}

function isHiddenModuleItem(item: { path: string; label: string; moduleCode: string | null }): boolean {
  if ((item.moduleCode ?? '').toLowerCase() === 'core') return true;
  if (item.path.startsWith('/m/core')) return true;
  if (item.path.startsWith('/m/dashboard')) return true;
  if (item.label.trim().toLowerCase() === 'core') return true;
  if (item.label.trim().toLowerCase() === 'dashboard') return true;
  return false;
}

function isEnabledModuleItem(
  item: { path: string; label: string; moduleCode: string | null },
  enabledModulesSet: Set<string>,
): boolean {
  const code = (item.moduleCode ?? inferModuleCodeFromPath(item.path) ?? '').toLowerCase();
  if (!code) return false;
  return enabledModulesSet.has(code);
}

function mergeModuleSubnavItems(
  primary: Array<{ path: string; label: string; moduleCode: string | null }>,
  fromEnabled: Array<{ path: string; label: string; moduleCode: string }>,
): Array<{ path: string; label: string; moduleCode: string | null }> {
  const merged: Array<{ path: string; label: string; moduleCode: string | null }> = [];
  const byCode = new Set<string>();
  const byPath = new Set<string>();
  for (const item of primary) {
    merged.push(item);
    byPath.add(item.path);
    if (item.moduleCode) byCode.add(item.moduleCode);
  }
  for (const item of fromEnabled) {
    if (byPath.has(item.path)) continue;
    if (item.moduleCode && byCode.has(item.moduleCode)) continue;
    merged.push(item);
    byPath.add(item.path);
    if (item.moduleCode) byCode.add(item.moduleCode);
  }
  return merged;
}

function buildNavItemsFallback(permissions: string[], _enabledModules: string[]): { path: string; label: string; order: number }[] {
  const items: { path: string; label: string; order: number }[] = [{ path: '/dashboard', label: 'Dashboard', order: 0 }];
  if (permissions.includes('settings:read')) items.push({ path: '/settings', label: 'Settings', order: 10 });
  if (permissions.includes('members:read')) items.push({ path: '/users-roles', label: 'Users & Roles', order: 20 });
  if (permissions.includes('clients:read')) items.push({ path: '/clients', label: 'Clients', order: 25 });
  if (permissions.includes('documents:read')) items.push({ path: '/documents', label: 'Documents', order: 26 });
  if (canSeeModulesCatalog(permissions)) items.push({ path: '/modules', label: 'Modules', order: 30 });
  if (permissions.includes('subscriptions:read')) items.push({ path: '/billing', label: 'Billing', order: 40 });
  return items;
}
