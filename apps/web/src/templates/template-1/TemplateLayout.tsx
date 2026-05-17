import React from 'react';
import { useLocation } from 'react-router-dom';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import type { SidebarAccountBlockModel } from '../../types/session';
import type { UiLanguageCode } from '../../types/session';

import './tokens.css';

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
  const isWorkEngineSection = location.pathname.startsWith('/work-engine/');
  const isWorkEngineQueuePage = location.pathname === '/work-engine/queue';
  const pageMaxWidth = isClientOperationsModule || isWorkEngineSection ? 1600 : 1100;

  return (
    <div className="t1-appShell" style={{ display: 'flex', minHeight: '100vh' }}>
      <AppSidebar
        items={sidebarItems}
        mode={isClientOperationsModule || isWorkEngineSection ? 'collapsedHover' : 'default'}
        accountBlock={sidebarAccountBlock}
        accountBusy={accountBusy}
        onSelectOrganization={onSelectOrg}
        onSetLanguage={onSetUiLanguage}
        onLogout={onSignOut}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!isWorkEngineQueuePage ? (
          <AppHeader
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            onSelectOrg={onSelectOrg}
            user={user}
            onSignOut={onSignOut}
          />
        ) : null}
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
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
