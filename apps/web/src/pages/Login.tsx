import React, { useEffect, useRef, useState } from 'react';
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
import { loginMfaFormVisible } from '../lib/login-mfa-challenge.pure';
import {
  classifyLoginSubmitFailure,
  loginUiErrorAfterRefetch,
  sessionUserMatchesLoginIdentifier,
} from '../lib/login-session-outcome.pure';
import { setBackendActiveOrganizationId } from '../api/org-context';
import { isStoredUiLang } from '../lib/public-ui-lang.pure';
import { clearTabWorkspace } from '../lib/tab-workspace.pure';
import { deviceSignOutOptions } from '../lib/device-session.pure';
import {
  beginLocalPasswordSwitch,
  endLocalPasswordSwitch,
  shouldClearLocalSessionBeforePasswordLogin,
} from '../lib/login-identity-switch.pure';
import { loginShowsEmailConfirmed } from '../lib/auth-confirm.pure';

export function Login() {
  const { t, lang, setLang } = useI18n();
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
  const acceptedLoginRef = useRef<{ identifier: string } | null>(null);
  const didFinishLoginNavRef = useRef(false);
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
  const emailConfirmed = loginShowsEmailConfirmed(location.search);

  function postLoginPath(sessionRedirect: string | null | undefined): string {
    const inviteAfterAuth = readStoredInviteReturnPath(
      typeof sessionStorage !== 'undefined' ? sessionStorage : null,
    );
    return resolvePostLoginDestination({
      inviteReturnPath: inviteAfterAuth,
      sessionRedirect,
      fallback: from,
    });
  }

  useEffect(() => {
    if (
      auth.status === 'authenticated' &&
      loginMfaFormVisible({
        sessionState: auth.me.session_state,
        sessionChallengeRequired: auth.me.mfa?.challenge_required,
      })
    ) {
      setChallengeRequired(true);
    }
  }, [auth]);

  const authenticatedMe = auth.status === 'authenticated' ? auth.me : null;
  useEffect(() => {
    const accepted = acceptedLoginRef.current;
    if (!accepted || !authenticatedMe) return;
    if (didFinishLoginNavRef.current) return;
    if (!sessionUserMatchesLoginIdentifier(authenticatedMe, accepted.identifier)) return;
    if (
      loginMfaFormVisible({
        sessionState: authenticatedMe.session_state,
        sessionChallengeRequired: authenticatedMe.mfa?.challenge_required,
      })
    ) {
      setChallengeRequired(true);
      return;
    }
    setError('');
    didFinishLoginNavRef.current = true;
    navigate(postLoginPath(authenticatedMe.redirect_to), { replace: true });
  }, [authenticatedMe, from, navigate]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  async function applyVerifiedMfaSession(result: { access_token?: string; refresh_token?: string }) {
    if (!result.access_token || !result.refresh_token) return;
    const { error } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (error) throw error;
  }

  async function persistPublicUiLanguage() {
    if (lang !== 'en' && lang !== 'he' && lang !== 'ru') return;
    await apiJson(AUTH.setUiLanguageCommand, {
      method: 'POST',
      body: JSON.stringify({ language_code: lang }),
    }).catch(() => undefined);
  }

  async function finishAuthenticatedNavigation() {
    let me = await refetchMe();
    if (!me) me = await refetchMe();
    if (
      loginMfaFormVisible({
        sessionState: me?.session_state,
        sessionChallengeRequired: me?.mfa?.challenge_required,
      })
    ) {
      setChallengeRequired(true);
      setError(loginSecurityText(uiLang, 'mfaChallenge'));
      return;
    }
    if (loginUiErrorAfterRefetch({ loginSucceeded: true, me }) === 'load_account') {
      setError(loginSecurityText(uiLang, 'loadAccountFailed'));
      return;
    }
    if (!me) return;
    const persisted = me.localization?.language?.persisted === true;
    const sessionLang =
      me.sidebar_account_block?.language_selector?.current_value
      ?? me.localization?.language?.current
      ?? null;
    if (persisted) {
      if (isStoredUiLang(sessionLang)) setLang(sessionLang);
    } else {
      await persistPublicUiLanguage();
    }
    if (didFinishLoginNavRef.current) return;
    didFinishLoginNavRef.current = true;
    navigate(postLoginPath(me.redirect_to), { replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cooldownSeconds > 0) {
      setError(loginCooldownMessage(cooldownSeconds, uiLang));
      return;
    }
    setError('');
    setLoading(true);
    const startedLocalSwitch = shouldClearLocalSessionBeforePasswordLogin({ challengeRequired });
    if (startedLocalSwitch) beginLocalPasswordSwitch();
    try {
      setBackendActiveOrganizationId(null);
      clearTabWorkspace(typeof sessionStorage === 'undefined' ? null : sessionStorage);
      if (startedLocalSwitch) {
        await supabase.auth.signOut(deviceSignOutOptions()).catch(() => undefined);
      }
      if (challengeRequired) {
        const verified = await apiJson<{ access_token?: string; refresh_token?: string }>(AUTH.mfaCommand('verify_mfa'), {
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ code: mfaCode.trim() }),
        });
        await applyVerifiedMfaSession(verified);
        await finishAuthenticatedNavigation();
        return;
      }
      const emailNorm = email.trim().toLowerCase();
      acceptedLoginRef.current = { identifier: emailNorm };
      const signedIn = await signInWithIdentifier(supabase, emailNorm, password);
      if (loginMfaFormVisible({ loginChallengeRequired: signedIn.challengeRequired })) {
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
      const kind = classifyLoginSubmitFailure(err);
      if (kind === 'rate_limit' || retryAfter > 0) {
        const seconds = retryAfter || 180;
        setCooldownUntil(Date.now() + seconds * 1000);
        setNowMs(Date.now());
        setError(loginCooldownMessage(seconds, uiLang));
      } else if (kind === 'mfa' || code === 'LOGIN_CHALLENGE_REQUIRED') {
        setChallengeRequired(true);
        setError(loginSecurityText(uiLang, 'mfaChallenge'));
      } else if (kind === 'email_not_confirmed' || code === 'EMAIL_NOT_CONFIRMED') {
        acceptedLoginRef.current = null;
        setError(loginSecurityText(uiLang, 'emailNotConfirmed'));
      } else if (kind === 'invalid_credentials') {
        acceptedLoginRef.current = null;
        setError(loginSecurityText(uiLang, 'invalidCredentials'));
      } else {
        setError(loginSecurityText(uiLang, 'loadAccountFailed'));
      }
    } finally {
      if (!didFinishLoginNavRef.current) endLocalPasswordSwitch();
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell title={t('auth.signIn')} testId="nx-login">
      {passwordResetOk && (
        <p className="nx-glass-alert nx-glass-alert--ok">{t('auth.passwordResetOk')}</p>
      )}
      {emailConfirmed && (
        <p className="nx-glass-alert nx-glass-alert--ok">{t('auth.emailConfirmed')}</p>
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
            : loading
              ? t('auth.signingIn')
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
