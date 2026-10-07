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
  const pageMaxWidth = isClientOperationsModule || isIncomeModule || isWorkEngineSection ? 1600 : 1100;

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
    header = isClientOperationsModule ? (
      <ClientOperationsAppHeader
        searchSlotRef={coHeaderSearchSlotRef}
        workspaceSlotRef={coHeaderWorkspaceSlotRef}
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
      className={`t1-appShell${isClientOperationsModule ? ' t1-appShell--client-operations' : ''}`}
      style={{ display: 'flex', minHeight: '100vh' }}
    >
      <AppSidebar
        items={sidebarItems}
        mode={isClientOperationsModule || isIncomeModule || isWorkEngineSection ? 'collapsedHover' : 'default'}
        appearance={isClientOperationsModule ? 'co-navy-glass' : 'default'}
        accountBlock={sidebarAccountBlock}
        accountBusy={accountBusy}
        onSelectOrganization={onSelectOrg}
        onSetLanguage={onSetUiLanguage}
        onLogout={onSignOut}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {header}
        <main
          className={
            isWorkEngineQueuePage ? 't1-pageMain t1-pageMain--work-engine-queue' : 't1-pageMain'
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
