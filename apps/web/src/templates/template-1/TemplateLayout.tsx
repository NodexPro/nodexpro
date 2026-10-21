import React, { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { ClientOperationsAppHeader } from './components/ClientOperationsAppHeader';
import {
  ClientOperationsHeaderSearchSlotContext,
  ClientOperationsHeaderWorkspaceSlotContext,
} from '../../components/client-operations/ClientOperationsHeaderSearchSlot';
import type { SidebarAccountBlockModel } from '../../types/session';
import type { UiLanguageCode } from '../../types/session';

import './tokens.css';
import '../../styles/nx-client-operations-shell.css';
import '../../styles/nx-glass-surface.css';

export type Template1SidebarItem = { to: string; label: string; children?: { to: string; label: string }[] };

export function TemplateLayout({
  organizations,
  activeOrganizationId,
  onSelectOrg,
  user,
  onSignOut,
  sidebarItems,
  sidebarAccountBlock,
  accountBusy,
  onSetUiLanguage,
  children,
}: {
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  onSelectOrg: (id: string) => Promise<void> | void;
  user: { email: string; fullName: string | null };
  onSignOut: () => Promise<void> | void;
  sidebarItems: Template1SidebarItem[];
  sidebarAccountBlock: SidebarAccountBlockModel;
  accountBusy?: boolean;
  onSetUiLanguage: (code: UiLanguageCode) => Promise<void> | void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const isClientOperationsModule = location.pathname.startsWith('/m/client-operations');
  const isIncomeModule = location.pathname.startsWith('/m/income');
  const isWorkEngineSection = location.pathname.startsWith('/work-engine/');
  const isWorkEngineQueuePage = location.pathname === '/work-engine/queue';
  // Users & Roles is an office working window: same collapsible navy rail as the employee workspace,
  // no generic top header (organization / user / language already live in the sidebar account block).
  const isUsersRolesWorkspace = location.pathname === '/users-roles';
  const isDashboard = location.pathname === '/dashboard';
  const isSettings = location.pathname === '/settings';
  // Office Clients list + details only — not Client Operations and not platform-owner clients.
  const isOfficeClients = location.pathname === '/clients' || /^\/clients\/[^/]+$/.test(location.pathname);
  const isOfficeBilling = location.pathname === '/billing';
  const isOfficeModules = location.pathname === '/modules';
  const isOfficeDocuments = location.pathname === '/documents' || /^\/documents\/[^/]+$/.test(location.pathname);
  const isOfficeGlassSurface = isOfficeClients || isOfficeBilling || isOfficeModules || isOfficeDocuments;
  // Every destination opened from the canonical sidebar uses the same working shell (navy backdrop +
  // collapsible glass AppSidebar). CO / Users & Roles / Dashboard / Settings / office glass pages are navy-native
  // surfaces; every other destination keeps its own light content inside a light surface (`t1-appShell--general`).
  const usesCanonicalWorkingShell = true;
  const isNavyNativeSurface =
    isClientOperationsModule || isUsersRolesWorkspace || isDashboard || isSettings || isOfficeGlassSurface;
  const pageMaxWidth =
    isClientOperationsModule ||
    isIncomeModule ||
    isWorkEngineSection ||
    isUsersRolesWorkspace ||
    isDashboard ||
    isSettings ||
    isOfficeGlassSurface
      ? 1600
      : 1100;

  // CO route only: header centre slot that receives the registry's existing search field (portal).
  const [coHeaderSearchSlot, setCoHeaderSearchSlot] = useState<HTMLElement | null>(null);
  const coHeaderSearchSlotRef = useCallback((el: HTMLDivElement | null) => setCoHeaderSearchSlot(el), []);
  const [coHeaderWorkspaceSlot, setCoHeaderWorkspaceSlot] = useState<HTMLElement | null>(null);
  const coHeaderWorkspaceSlotRef = useCallback(
    (el: HTMLDivElement | null) => setCoHeaderWorkspaceSlot(el),
    [],
  );

  let header: React.ReactNode = null;
  if (!isWorkEngineQueuePage) {
    // Users & Roles and Dashboard render no header strip (account / org / language live in the sidebar).
    header = isUsersRolesWorkspace || isDashboard || isSettings || isOfficeGlassSurface ? null : isClientOperationsModule ? (
      <ClientOperationsAppHeader
        searchSlotRef={coHeaderSearchSlotRef}
        workspaceSlotRef={coHeaderWorkspaceSlotRef}
        greetingText={sidebarAccountBlock.workspace_greeting?.text ?? null}
      />
    ) : (
      <AppHeader
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
        onSelectOrg={onSelectOrg}
        user={user}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <div
      className={`t1-appShell${usesCanonicalWorkingShell ? ' t1-appShell--client-operations' : ''}${isUsersRolesWorkspace ? ' t1-appShell--users-roles' : ''}${isNavyNativeSurface ? '' : ' t1-appShell--general'}`}
      style={{ display: 'flex', minHeight: '100vh' }}
    >
      <AppSidebar
        items={sidebarItems}
        mode={usesCanonicalWorkingShell || isIncomeModule || isWorkEngineSection ? 'collapsedHover' : 'default'}
        appearance={usesCanonicalWorkingShell ? 'co-navy-glass' : 'default'}
        accountBlock={sidebarAccountBlock}
        accountBusy={accountBusy}
        onSelectOrganization={onSelectOrg}
        onSetLanguage={onSetUiLanguage}
        onLogout={onSignOut}
      />
      <div className="t1-shellColumn" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {header}
        <main
          className={
            isWorkEngineQueuePage
              ? 't1-pageMain t1-pageMain--work-engine-queue'
              : isDashboard
                ? 't1-pageMain t1-pageMain--dashboard'
                : isSettings
                  ? 't1-pageMain t1-pageMain--settings'
                  : 't1-pageMain'
          }
        >
          <div
            style={{
              maxWidth: pageMaxWidth,
              margin: '0 auto',
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
            }}
          >
            <ClientOperationsHeaderSearchSlotContext.Provider
              value={isClientOperationsModule ? coHeaderSearchSlot : null}
            >
              <ClientOperationsHeaderWorkspaceSlotContext.Provider
                value={isClientOperationsModule ? coHeaderWorkspaceSlot : null}
              >
                {children}
              </ClientOperationsHeaderWorkspaceSlotContext.Provider>
            </ClientOperationsHeaderSearchSlotContext.Provider>
          </div>
        </main>
      </div>
    </div>
  );
}
