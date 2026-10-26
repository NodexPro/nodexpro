import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { signInWithIdentifier } from '../lib/sign-in-with-identifier';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../api/client';
import { loginCooldownMessage, remainingCooldownSeconds, retryAfterSecondsFromFailure } from '../lib/login-cooldown.pure';
import {
  captureInviteReturnPath,
  readStoredInviteReturnPath,
  resolvePostLoginDestination,
} from '../lib/invite-return-path.pure';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cooldownSeconds = remainingCooldownSeconds(cooldownUntil, nowMs);
  const navigate = useNavigate();
  const location = useLocation();
  const { refetchMe } = useAuth();
  const redirectParam = new URLSearchParams(location.search).get('redirect');
  const from = redirectParam ?? (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';
  const inviteReturnPath = captureInviteReturnPath(
    typeof sessionStorage !== 'undefined' ? sessionStorage : null,
    redirectParam,
  );
  const registerTo = inviteReturnPath
    ? `/register?redirect=${encodeURIComponent(inviteReturnPath)}`
    : '/register';
  const passwordResetOk = Boolean((location.state as { passwordResetOk?: boolean } | null)?.passwordResetOk);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldownSeconds > 0) {
      setError(loginCooldownMessage(cooldownSeconds));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const emailNorm = email.trim().toLowerCase();
      await signInWithIdentifier(supabase, emailNorm, password);

      const me = await refetchMe();
      if (!me) {
        setError('Could not load your account. Please try again.');
        setLoading(false);
        return;
      }
      const inviteAfterAuth = readStoredInviteReturnPath(
        typeof sessionStorage !== 'undefined' ? sessionStorage : null,
      );
      const redirectTo = resolvePostLoginDestination({
        inviteReturnPath: inviteAfterAuth,
        sessionRedirect: me.redirect_to,
        fallback: from,
      });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const retryAfter = err instanceof ApiError
        ? retryAfterSecondsFromFailure({ status: err.status, retryAfter: err.details?.retry_after })
        : 0;
      if (retryAfter > 0) {
        setCooldownUntil(Date.now() + retryAfter * 1000);
        setNowMs(Date.now());
        setError(loginCooldownMessage(retryAfter));
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Sign in</h1>
      {passwordResetOk && (
        <p style={{ color: '#059669', marginBottom: 16 }}>Password updated. Sign in with your new password.</p>
      )}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button type="submit" disabled={loading || cooldownSeconds > 0}>
          {cooldownSeconds > 0 ? loginCooldownMessage(cooldownSeconds) : 'Sign in'}
        </button>
      </form>
      <p style={{ marginTop: 12 }}>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p style={{ marginTop: 16 }}>
        <Link to={registerTo}>Create account</Link>
      </p>
    </div>
  );
}
