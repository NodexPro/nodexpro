import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/I18nProvider';
import { PublicAuthShell } from '../components/auth/PublicAuthShell';

/**
 * After reset link: Supabase redirects with hash (implicit) or ?code= (PKCE).
 * Auth client emits PASSWORD_RECOVERY or establishes a session we can use with updateUser.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid'>('loading');

  useEffect(() => {
    let cancelled = false;
    const hash = window.location.hash;
    const recoveryHint =
      hash.includes('type=recovery') ||
      hash.includes('type%3Drecovery') ||
      new URLSearchParams(window.location.search).has('code');

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') {
        setPhase('ready');
        return;
      }
      if (event === 'SIGNED_IN' && session && recoveryHint) {
        setPhase('ready');
      }
    });

    const bumpIfRecoverable = (): void => {
      void supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (data.session && recoveryHint) {
          setPhase('ready');
        }
      });
    };

    bumpIfRecoverable();
    const t1 = window.setTimeout(bumpIfRecoverable, 400);
    const t2 = window.setTimeout(bumpIfRecoverable, 1200);

    const tInvalid = window.setTimeout(() => {
      if (cancelled) return;
      setPhase((p) => (p === 'loading' ? 'invalid' : p));
    }, 5000);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(tInvalid);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError(t('auth.passwordMin'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.passwordsMismatch'));
      return;
    }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw new Error(updErr.message);
      await supabase.auth.signOut();
      navigate('/login', { replace: true, state: { passwordResetOk: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.updatePasswordFailed'));
    } finally {
      setLoading(false);
    }
  }

  if (phase === 'loading') {
    return (
      <PublicAuthShell title={t('auth.setNewPassword')} testId="nx-reset-password">
        <p className="nx-glass-muted">{t('auth.verifyingReset')}</p>
      </PublicAuthShell>
    );
  }

  if (phase === 'invalid') {
    return (
      <PublicAuthShell title={t('auth.setNewPassword')} testId="nx-reset-password">
        <p className="nx-glass-alert nx-glass-alert--error" role="alert">
          {t('auth.resetInvalid')}
        </p>
        <div className="nx-glass-auth__links">
          <p>
            <Link className="nx-glass-link" to="/forgot-password">
              {t('auth.forgotPassword')}
            </Link>
            {' · '}
            <Link className="nx-glass-link" to="/login">
              {t('auth.signIn')}
            </Link>
          </p>
        </div>
      </PublicAuthShell>
    );
  }

  return (
    <PublicAuthShell title={t('auth.setNewPassword')} testId="nx-reset-password">
      <form onSubmit={handleSubmit} aria-busy={loading}>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="password">
            {t('auth.newPassword')}
          </label>
          <input
            id="password"
            className="nx-glass-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="confirm">
            {t('auth.confirmPassword')}
          </label>
          <input
            id="confirm"
            className="nx-glass-input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>
        {error && (
          <p className="nx-glass-alert nx-glass-alert--error" role="alert">
            {error}
          </p>
        )}
        <button className="nx-glass-btn nx-glass-btn--purple" type="submit" disabled={loading}>
          {loading ? t('auth.savingPassword') : t('auth.savePassword')}
        </button>
      </form>
      <div className="nx-glass-auth__links">
        <p>
          <Link className="nx-glass-link" to="/login">
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </div>
    </PublicAuthShell>
  );
}
