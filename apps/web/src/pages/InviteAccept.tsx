import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError, apiJson } from '../api/client';
import { inviteAccept } from '../api/endpoints';
import {
  clearStoredInviteReturnPath,
  isDefinitiveInviteRejection,
  parseInviteReturnPath,
  captureInviteReturnPath,
} from '../lib/invite-return-path.pure';

export function InviteAccept() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    if (!token) {
      clearStoredInviteReturnPath(storage);
      setStatus('error');
      setMessage('Invalid invite link');
      return;
    }
    const returnPath = parseInviteReturnPath(`${window.location.pathname}${window.location.search}`);
    if (returnPath) captureInviteReturnPath(storage, returnPath);
    if (auth.status !== 'authenticated') {
      const loginTarget = returnPath
        ? `/login?redirect=${encodeURIComponent(returnPath)}`
        : `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      navigate(loginTarget);
      return;
    }
  }, [token, auth.status, navigate]);

  useEffect(() => {
    if (!token || auth.status !== 'authenticated' || status !== 'idle') return;
    setStatus('accepting');
    apiJson<{ success: boolean; organization_id: string }>(inviteAccept(), {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(async () => {
        clearStoredInviteReturnPath(typeof sessionStorage !== 'undefined' ? sessionStorage : null);
        setStatus('success');
        await auth.refetchMe?.();
        setTimeout(() => navigate('/dashboard'), 2000);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : 'Failed to accept invitation';
        const code = e instanceof ApiError ? e.code : undefined;
        if (isDefinitiveInviteRejection({ message, code })) {
          clearStoredInviteReturnPath(typeof sessionStorage !== 'undefined' ? sessionStorage : null);
        }
        setStatus('error');
        setMessage(message);
      });
  }, [token, auth.status, status]);

  if (!token) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h1>Invalid Invite Link</h1>
        <p style={{ color: '#6b7280' }}>This invitation link is invalid or has expired.</p>
        <a href="/" style={{ color: '#059669', marginTop: 16, display: 'inline-block' }}>Go to Dashboard</a>
      </div>
    );
  }

  if (auth.status !== 'authenticated') {
    return null;
  }

  if (status === 'accepting') {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h1>Accepting Invitation…</h1>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h1>Welcome!</h1>
        <p style={{ color: '#059669' }}>You have joined the organization. Redirecting…</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <h1>Invitation Failed</h1>
      <p style={{ color: '#b91c1c' }}>{message}</p>
      <a href="/dashboard" style={{ color: '#059669', marginTop: 16, display: 'inline-block' }}>Go to Dashboard</a>
    </div>
  );
}
