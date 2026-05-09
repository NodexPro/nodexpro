import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { RequireAuth } from './components/guards/RequireAuth';
import { RequireOrg } from './components/guards/RequireOrg';
import { AppShell } from './components/layout/AppShell';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Register } from './pages/Register';
import { CreateOrganization } from './pages/CreateOrganization';
import { SelectOrganization } from './pages/SelectOrganization';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { UsersRoles } from './pages/UsersRoles';
import { Modules } from './pages/Modules';
import { Billing } from './pages/Billing';
import { ExampleModulePage } from './pages/ExampleModulePage';
import { ClientOperationsRegistry } from './pages/ClientOperationsRegistry';
import { ClientOperationsClientCase } from './pages/ClientOperationsClientCase';
import { Clients } from './pages/Clients';
import { ClientCard } from './pages/ClientCard';
import { Documents } from './pages/Documents';
import { DocumentCard } from './pages/DocumentCard';
import { InviteAccept } from './pages/InviteAccept';
import { ClientPortalInvite } from './pages/ClientPortalInvite';
import { ClientPortalDocflow } from './pages/ClientPortalDocflow';
import { PlatformOwnerLogin } from './pages/PlatformOwnerLogin';
import { PlatformOwnerLegalControl } from './pages/PlatformOwnerLegalControl';
import { DocflowCommunicationReviewPage } from './pages/DocflowCommunicationReviewPage';
import { DocflowInvitesManagementPage } from './pages/DocflowInvitesManagementPage';
import { DocflowMessengerPage } from './pages/DocflowMessengerPage';
import { I18nProvider } from './i18n/I18nProvider';

function PwaUpdatePrompt() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let disposed = false;

    const onControllerChange = () => {
      window.location.reload();
    };

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (disposed) return;

        if (reg.waiting) {
          setWaitingWorker(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(reg.waiting ?? installing);
            }
          });
        });
      } catch {
        // Ignore registration errors - app still works without offline shell.
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void register();

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <div
      style={{
        position: 'fixed',
        insetInlineStart: 12,
        insetInlineEnd: 12,
        bottom: 12,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        background: '#111827',
        color: '#F9FAFB',
        border: '1px solid #374151',
        borderRadius: 10,
        padding: '10px 12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
      }}
      role="status"
      aria-live="polite"
    >
      <span style={{ fontSize: 13.5 }}>New version available - refresh</span>
      <button
        type="button"
        className="nx-btn nx-btn-taxes-compact"
        onClick={() => waitingWorker.postMessage({ type: 'SKIP_WAITING' })}
      >
        Refresh
      </button>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/platform-owner/login" element={<PlatformOwnerLogin />} />
      <Route path="/platform-owner/legal-control" element={<PlatformOwnerLegalControl />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/accept" element={<InviteAccept />} />
      <Route path="/invite/:token" element={<ClientPortalInvite />} />
      <Route path="/client-portal/invite/:token" element={<ClientPortalInvite />} />
      <Route path="/client-portal/docflow" element={<ClientPortalDocflow />} />
      <Route path="/onboarding" element={<RequireAuth><CreateOrganization /></RequireAuth>} />
      <Route path="/select-org" element={<RequireAuth><SelectOrganization /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><RequireOrg><AppShell /></RequireOrg></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="settings" element={<Settings />} />
        <Route path="users-roles" element={<UsersRoles />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:clientId" element={<ClientCard />} />
        <Route path="documents" element={<Documents />} />
        <Route path="documents/:documentId" element={<DocumentCard />} />
        <Route path="modules" element={<Modules />} />
        <Route path="billing" element={<Billing />} />
        <Route path="m/example" element={<ExampleModulePage />} />
        <Route path="m/docflow/invites" element={<DocflowInvitesManagementPage />} />
        <Route path="m/docflow/review" element={<DocflowCommunicationReviewPage />} />
        <Route path="m/docflow/messenger" element={<DocflowMessengerPage />} />
        <Route path="m/client-operations" element={<ClientOperationsRegistry />} />
        <Route path="m/client-operations/clients/:clientId" element={<ClientOperationsClientCase />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PwaUpdatePrompt />
      <I18nProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
