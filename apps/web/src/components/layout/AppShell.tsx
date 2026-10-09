import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import { TemplateLayout } from '../../templates/template-1/TemplateLayout';
import { ReminderToasts } from '../ReminderToasts';
import { DocflowFloatingWidget } from '../DocflowFloatingWidget';
import { isClientOperationsReminderToastsEnabled } from '../../lib/client-operations-reminder-toasts-access.pure';
import { RequireWorkerRoute } from '../guards/RequireWorkerRoute';

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

  const navigation = Array.isArray(me.available_navigation)
    ? me.available_navigation
    : Array.isArray(me.visible_nav_items)
      ? me.visible_nav_items
      : [];
  const navItems = navigation.map((n) => ({ path: n.path, label: n.label, order: n.order }));

  const moduleSource = Array.isArray(me.available_modules)
    ? me.available_modules
    : (me.moduleAppNavItems ?? []);
  const docflowWidgetAllowed =
    Array.isArray(me.available_modules) &&
    me.available_modules.some((item) => String(item.path ?? '').includes('/m/docflow'));
  const enabledModulesSet = new Set((me.enabledModules ?? []).map((m) => m.toLowerCase()));
  const moduleChildren = moduleSource
    .map((n) => ({
      path: n.path,
      label: n.label,
      moduleCode: inferModuleCodeFromPath(n.path),
    }))
    .filter((item) => !isHiddenModuleItem(item) && isEnabledModuleItem(item, enabledModulesSet))
    .map((c) => ({ to: c.path, label: c.label }));

  const sidebarItems = navItems
    .filter((n) => !n.path.startsWith('/m/'))
    .map((n) =>
      n.path === '/modules' && moduleChildren.length
        ? { to: n.path, label: n.label, children: moduleChildren }
        : { to: n.path, label: n.label },
    );

  const reminderEnabled = isClientOperationsReminderToastsEnabled({
    enabledModules: me.enabledModules,
    permissions: me.permissions,
  });

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
        <RequireWorkerRoute>
          <Outlet />
        </RequireWorkerRoute>
      </TemplateLayout>
      <ReminderToasts enabled={reminderEnabled} />
      {docflowWidgetAllowed ? <DocflowFloatingWidget /> : null}
    </>
  );
}

function inferModuleCodeFromPath(path: string): string | null {
  if (path.startsWith('/m/core')) return 'core';
  if (path.startsWith('/m/client-operations')) return 'client-operations';
  if (path.startsWith('/m/docflow')) return 'docflow';
  if (path.startsWith('/m/income')) return 'invoice';
  if (path.startsWith('/work-engine')) return 'work_engine';
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
