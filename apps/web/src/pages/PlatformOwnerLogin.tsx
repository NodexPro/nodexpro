import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { apiJson, apiJsonPublic, ApiError } from '../api/client';
import { OWNER } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';

type RecoveryStep = 1 | 2 | 3 | 4;

export function PlatformOwnerLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>(1);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySessionId, setRecoverySessionId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  const navigate = useNavigate();
  const location = useLocation();
  const { refetchMe } = useAuth();

  const redirectParam = new URLSearchParams(location.search).get('redirect');
  const from = redirectParam ?? '/platform-owner/legal-control';

  function closeRecoveryModal(): void {
    setRecoveryOpen(false);
    setRecoveryStep(1);
    setRecoveryEmail('');
    setRecoverySessionId('');
    setOtpCode('');
    setNewPassword('');
    setConfirmPassword('');
    setRecoveryError('');
    setRecoveryBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(signInError.message);
      if (!data.session) throw new Error('No session after sign in');
      await refetchMe();
      try {
        await apiJson(OWNER.session);
      } catch (se) {
        if (se instanceof ApiError && (se.status === 403 || se.status === 401)) {
          await supabase.auth.signOut();
          setError('Access denied. Platform owner only.');
          setLoading(false);
          return;
        }
        throw se;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecoveryRequest(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      const out = (await apiJsonPublic<{ ok?: boolean; recovery_session_id?: string }>(OWNER.passwordRecoveryRequest, {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail.trim() }),
      })) as { recovery_session_id?: string };
      const sid = typeof out.recovery_session_id === 'string' ? out.recovery_session_id : '';
      if (!sid) throw new Error('Invalid server response');
      setRecoverySessionId(sid);
      setRecoveryStep(2);
    } catch {
      setRecoveryError('Failed to send recovery email');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function handleRecoveryVerify(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      await apiJsonPublic(OWNER.passwordRecoveryVerify, {
        method: 'POST',
        body: JSON.stringify({ recovery_session_id: recoverySessionId, code: otpCode.trim() }),
      });
      setRecoveryStep(3);
    } catch (ve) {
      setRecoveryError(ve instanceof ApiError ? ve.message : 'Failed to send recovery email');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function handleRecoveryComplete(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError('');
    if (newPassword !== confirmPassword) {
      setRecoveryError('Passwords do not match');
      return;
    }
    setRecoveryBusy(true);
    try {
      await apiJsonPublic(OWNER.passwordRecoveryComplete, {
        method: 'POST',
        body: JSON.stringify({ recovery_session_id: recoverySessionId, new_password: newPassword }),
      });
      setRecoveryStep(4);
    } catch (ce) {
      setRecoveryError(ce instanceof ApiError ? ce.message : 'Failed to send recovery email');
    } finally {
      setRecoveryBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: 24 }}>
      <h1>Platform Owner Login</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>Access to this area is restricted to platform owner only.</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="owner-email">Email</label>
          <input
            id="owner-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="owner-password">Password</label>
          <input
            id="owner-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
          <button
            type="button"
            onClick={() => {
              setRecoveryOpen(true);
              setRecoveryStep(1);
              setRecoveryEmail(email);
              setRecoveryError('');
              setRecoverySessionId('');
              setOtpCode('');
              setNewPassword('');
              setConfirmPassword('');
            }}
            style={{ marginTop: 8, padding: 0, border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', fontSize: 14 }}
          >
            Forgot password?
          </button>
        </div>
        {error ? <p style={{ color: 'red', marginBottom: 12 }}>{error}</p> : null}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      {recoveryOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
          onClick={(ev) => {
            if (ev.target === ev.currentTarget) closeRecoveryModal();
          }}
        >
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 400, width: '100%', padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontSize: 18, marginTop: 0 }}>Reset password</h2>

            {recoveryStep === 1 ? (
              <form onSubmit={handleRecoveryRequest}>
                <p style={{ color: '#666', fontSize: 14 }}>Step 1 — Enter your platform owner email</p>
                <label htmlFor="recovery-email">Email</label>
                <input
                  id="recovery-email"
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  required
                  autoComplete="email"
                  style={{ display: 'block', width: '100%', padding: 8, marginBottom: 12 }}
                />
                {recoveryError ? <p style={{ color: '#b91c1c', marginBottom: 8 }}>{recoveryError}</p> : null}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => closeRecoveryModal()}>
                    Cancel
                  </button>
                  <button type="submit" disabled={recoveryBusy} className="nx-btn nx-btn-taxes-compact">
                    {recoveryBusy ? 'Sending…' : 'Send code'}
                  </button>
                </div>
              </form>
            ) : null}

            {recoveryStep === 2 ? (
              <form onSubmit={handleRecoveryVerify}>
                <p style={{ color: '#666', fontSize: 14 }}>Step 2 — Enter the SMS code</p>
                <p style={{ color: '#15803d', fontSize: 14 }}>Recovery email sent</p>
                <label htmlFor="recovery-otp">Code</label>
                <input
                  id="recovery-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  required
                  style={{ display: 'block', width: '100%', padding: 8, marginBottom: 12 }}
                />
                {recoveryError ? <p style={{ color: '#b91c1c', marginBottom: 8 }}>{recoveryError}</p> : null}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => closeRecoveryModal()}>
                    Cancel
                  </button>
                  <button type="submit" disabled={recoveryBusy} className="nx-btn nx-btn-taxes-compact">
                    {recoveryBusy ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
              </form>
            ) : null}

            {recoveryStep === 3 ? (
              <form onSubmit={handleRecoveryComplete}>
                <p style={{ color: '#666', fontSize: 14 }}>Step 3 — New password</p>
                <label htmlFor="recovery-pw">New password</label>
                <input
                  id="recovery-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  style={{ display: 'block', width: '100%', padding: 8, marginBottom: 8 }}
                />
                <label htmlFor="recovery-pw2">Confirm password</label>
                <input
                  id="recovery-pw2"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  style={{ display: 'block', width: '100%', padding: 8, marginBottom: 12 }}
                />
                {recoveryError ? <p style={{ color: '#b91c1c', marginBottom: 8 }}>{recoveryError}</p> : null}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => closeRecoveryModal()}>
                    Cancel
                  </button>
                  <button type="submit" disabled={recoveryBusy} className="nx-btn nx-btn-taxes-compact">
                    {recoveryBusy ? 'Saving…' : 'Save password'}
                  </button>
                </div>
              </form>
            ) : null}

            {recoveryStep === 4 ? (
              <div>
                <p style={{ color: '#15803d', fontSize: 15, fontWeight: 600 }}>Step 4 — Your password was updated.</p>
                <p style={{ color: '#666', fontSize: 14 }}>You can sign in with your new password.</p>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => closeRecoveryModal()}>
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
