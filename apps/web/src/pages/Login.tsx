import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { signInWithIdentifier } from '../lib/sign-in-with-identifier';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, ApiError } from '../api/client';
import { AUTH } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { PublicAuthShell } from '../components/auth/PublicAuthShell';
import {
  loginCooldownMessage,
  loginFailureCode,
  loginSecurityText,
  loginUiLang,
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
  const { t, lang } = useI18n();
  const uiLang = loginUiLang(lang);
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
      setError(loginSecurityText(uiLang, 'mfaChallenge'));
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
      setError(loginCooldownMessage(cooldownSeconds, uiLang));
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
        setError(loginSecurityText(uiLang, 'mfaChallenge'));
        return;
      }
      await finishAuthenticatedNavigation();
    } catch (err) {
      const code = err instanceof ApiError ? loginFailureCode({ code: err.code, status: err.status }) : null;
      const retryAfter = err instanceof ApiError
        ? retryAfterSecondsFromFailure({ status: err.status, retryAfter: err.details?.retry_after })
        : 0;
      const recovery = err instanceof ApiError
        ? offerRecoveryFromFailure({ offerRecovery: err.details?.offer_recovery })
        : false;
      setOfferRecovery(recovery);
      if (code === 'TOO_MANY_REQUESTS' || retryAfter > 0) {
        const seconds = retryAfter || 180;
        setCooldownUntil(Date.now() + seconds * 1000);
        setNowMs(Date.now());
        setError(loginCooldownMessage(seconds, uiLang));
      } else if (code === 'LOGIN_CHALLENGE_REQUIRED') {
        setChallengeRequired(true);
        setError(loginSecurityText(uiLang, 'mfaChallenge'));
      } else {
        setError(loginSecurityText(uiLang, 'invalidCredentials'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell title={t('auth.signIn')} testId="nx-login">
      {passwordResetOk && (
        <p className="nx-glass-alert nx-glass-alert--ok">{t('auth.passwordResetOk')}</p>
      )}
      <form onSubmit={handleSubmit} aria-busy={loading}>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="email">
            {t('auth.email')}
          </label>
          <input
            id="email"
            className="nx-glass-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="password">
            {t('auth.password')}
          </label>
          <input
            id="password"
            className="nx-glass-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!challengeRequired}
          />
        </div>
        {challengeRequired ? (
          <div className="nx-glass-field">
            <label className="nx-glass-label" htmlFor="mfa-code">
              {t('auth.mfaChallenge')}
            </label>
            <input
              id="mfa-code"
              className="nx-glass-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              required
            />
          </div>
        ) : null}
        {error && (
          <p className="nx-glass-alert nx-glass-alert--error" role="alert">
            {error}
          </p>
        )}
        <button
          className="nx-glass-btn nx-glass-btn--purple"
          type="submit"
          disabled={loading || cooldownSeconds > 0}
        >
          {cooldownSeconds > 0
            ? loginCooldownMessage(cooldownSeconds, uiLang)
            : challengeRequired
              ? t('auth.verifyCode')
              : t('auth.signIn')}
        </button>
      </form>
      <div className={`nx-glass-auth__links${offerRecovery ? ' nx-glass-alert nx-glass-alert--ok' : ''}`}>
        <p>
          <Link className="nx-glass-link" to="/forgot-password">
            {t('auth.recoveryPrompt')}
          </Link>
          {offerRecovery ? <span className="nx-glass-muted">{t('auth.recoveryHint')}</span> : null}
        </p>
        <p>
          <Link className="nx-glass-link" to={registerTo}>
            {t('auth.createAccount')}
          </Link>
        </p>
      </div>
    </PublicAuthShell>
  );
}
