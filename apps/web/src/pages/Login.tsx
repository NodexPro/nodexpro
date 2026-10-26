import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { signInWithIdentifier } from '../lib/sign-in-with-identifier';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, ApiError } from '../api/client';
import { AUTH } from '../api/endpoints';
import {
  loginCooldownMessage,
  offerRecoveryFromFailure,
  remainingCooldownSeconds,
  retryAfterSecondsFromFailure,
} from '../lib/login-cooldown.pure';
import {
  captureInviteReturnPath,
  readStoredInviteReturnPath,
  resolvePostLoginDestination,
} from '../lib/invite-return-path.pure';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [offerRecovery, setOfferRecovery] = useState(false);
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cooldownSeconds = remainingCooldownSeconds(cooldownUntil, nowMs);
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { refetchMe } = auth;
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
    if (auth.status === 'authenticated' && auth.me.session_state === 'mfa_challenge') {
      setChallengeRequired(true);
    }
  }, [auth]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function finishAuthenticatedNavigation() {
    const me = await refetchMe();
    if (!me || me.session_state === 'mfa_challenge') {
      setChallengeRequired(true);
      setError('Enter the authenticator code to continue.');
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
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldownSeconds > 0) {
      setError(loginCooldownMessage(cooldownSeconds));
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (challengeRequired) {
        await apiJson(AUTH.mfaCommand('verify_mfa'), {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ code: mfaCode.trim() }),
        });
        await finishAuthenticatedNavigation();
        return;
      }
      const emailNorm = email.trim().toLowerCase();
      const signedIn = await signInWithIdentifier(supabase, emailNorm, password);
      if (signedIn.challengeRequired) {
        setChallengeRequired(true);
        setError('Enter the authenticator code to continue.');
        return;
      }
      await finishAuthenticatedNavigation();
    } catch (err) {
      const retryAfter = err instanceof ApiError
        ? retryAfterSecondsFromFailure({ status: err.status, retryAfter: err.details?.retry_after })
        : 0;
      const recovery = err instanceof ApiError
        ? offerRecoveryFromFailure({ offerRecovery: err.details?.offer_recovery })
        : false;
      setOfferRecovery(recovery);
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
            required={!challengeRequired}
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </div>
        {challengeRequired ? (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="mfa-code">Authenticator code</label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              required
              style={{ display: 'block', width: '100%', padding: 8 }}
            />
          </div>
        ) : null}
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button type="submit" disabled={loading || cooldownSeconds > 0}>
          {cooldownSeconds > 0
            ? loginCooldownMessage(cooldownSeconds)
            : challengeRequired
              ? 'Verify code'
              : 'Sign in'}
        </button>
      </form>
      <p
        style={
          offerRecovery
            ? {
                marginTop: 16,
                padding: 12,
                border: '1px solid #2563eb',
                background: '#eff6ff',
                fontWeight: 700,
              }
            : { marginTop: 12 }
        }
      >
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p style={{ marginTop: 16 }}>
        <Link to={registerTo}>Create account</Link>
      </p>
    </div>
  );
}
