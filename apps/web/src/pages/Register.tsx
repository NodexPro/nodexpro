import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AUTH } from '../api/endpoints';
import { ApiError, apiJson } from '../api/client';
import {
  captureInviteReturnPath,
  readStoredInviteReturnPath,
  resolvePostRegisterDestination,
} from '../lib/invite-return-path.pure';
import {
  confirmationEmailAddress,
  fillRegisteredEmail,
  isEmailNotConfirmedCode,
  signupNeedsEmailConfirmation,
} from '../lib/register-email-confirmation.pure';
import { useI18n } from '../i18n/I18nProvider';
import { PublicAuthShell } from '../components/auth/PublicAuthShell';
import { GlassModal } from '../components/glass/GlassModal';

type RegisterResult = {
  session?: unknown | null;
  email?: string | null;
  email_confirmation_required?: boolean;
};

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang } = useI18n();
  const redirectParam = new URLSearchParams(location.search).get('redirect');
  captureInviteReturnPath(typeof sessionStorage !== 'undefined' ? sessionStorage : null, redirectParam);
  const loginTo = redirectParam ? `/login?redirect=${encodeURIComponent(redirectParam)}` : '/login';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setConfirmEmail(null);
    setLoading(true);
    try {
      const result = await apiJson<RegisterResult>(AUTH.register, {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          fullName: fullName || undefined,
          language_code: lang,
        }),
      });
      const shownEmail = confirmationEmailAddress(email, result.email);
      if (
        result.email_confirmation_required === true ||
        signupNeedsEmailConfirmation({ registerSucceeded: true, session: result.session })
      ) {
        setConfirmEmail(shownEmail);
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        if (isEmailNotConfirmedCode(signInError.code) || /email not confirmed/i.test(signInError.message ?? '')) {
          setConfirmEmail(shownEmail);
          return;
        }
        throw signInError;
      }
      if (lang === 'en' || lang === 'he' || lang === 'ru') {
        await apiJson(AUTH.setUiLanguageCommand, {
          method: 'POST',
          body: JSON.stringify({ language_code: lang }),
        }).catch(() => undefined);
      }
      const inviteReturnPath = readStoredInviteReturnPath(
        typeof sessionStorage !== 'undefined' ? sessionStorage : null,
      );
      navigate(resolvePostRegisterDestination(inviteReturnPath), { replace: true });
    } catch (err) {
      setConfirmEmail(null);
      if (err instanceof ApiError && isEmailNotConfirmedCode(err.code)) {
        setError(t('auth.emailNotConfirmed'));
      } else {
        setError(t('auth.registerFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PublicAuthShell title={t('auth.createAccount')} testId="nx-register">
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
            enterKeyHint="next"
            placeholder={t('auth.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="fullName">
            {t('auth.fullName')}
          </label>
          <input
            id="fullName"
            className="nx-glass-input"
            type="text"
            autoComplete="name"
            enterKeyHint="next"
            placeholder={t('auth.fullName')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
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
            autoComplete="new-password"
            enterKeyHint="done"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="nx-glass-alert nx-glass-alert--error" role="alert">
            {error}
          </p>
        )}
        <button className="nx-glass-btn nx-glass-btn--purple" type="submit" disabled={loading}>
          {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
        </button>
      </form>
      <div className="nx-glass-auth__links">
        <p>
          <Link className="nx-glass-link" to={loginTo}>
            {t('auth.signIn')}
          </Link>
        </p>
      </div>
      <GlassModal
        open={Boolean(confirmEmail)}
        title={t('auth.confirmEmailTitle')}
        testId="nx-register-confirm-email"
        onClose={() => navigate(loginTo)}
        footer={
          <Link className="nx-glass-btn nx-glass-btn--purple" to={loginTo}>
            {t('auth.goToSignIn')}
          </Link>
        }
      >
        <p className="nx-glass-copy">
          {fillRegisteredEmail(t('auth.confirmEmailBody'), confirmEmail ?? '')}
        </p>
        {confirmEmail ? (
          <p className="nx-glass-copy" dir="ltr">
            {confirmEmail}
          </p>
        ) : null}
      </GlassModal>
    </PublicAuthShell>
  );
}
