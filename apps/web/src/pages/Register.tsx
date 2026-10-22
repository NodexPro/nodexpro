import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AUTH } from '../api/endpoints';
import { apiJson } from '../api/client';
import {
  captureInviteReturnPath,
  readStoredInviteReturnPath,
  resolvePostRegisterDestination,
} from '../lib/invite-return-path.pure';
import { useI18n } from '../i18n/I18nProvider';
import { UiLanguageSwitch } from '../components/glass/UiLanguageSwitch';
import logoSrc from '../templates/template-1/assets/nodexpro-logo.png';
import '../styles/nx-glass-surface.css';
import '../styles/nx-office-deep-ocean.css';

export function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang } = useI18n();
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const redirectParam = new URLSearchParams(location.search).get('redirect');
  captureInviteReturnPath(typeof sessionStorage !== 'undefined' ? sessionStorage : null, redirectParam);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiJson(AUTH.register, {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName: fullName || undefined }),
      });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(signInError.message);
      const inviteReturnPath = readStoredInviteReturnPath(
        typeof sessionStorage !== 'undefined' ? sessionStorage : null,
      );
      navigate(resolvePostRegisterDestination(inviteReturnPath), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.registerFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="nx-glass-auth nx-office-ocean nx-register-ocean" data-testid="nx-register" dir={dir} lang={lang}>
      <div className="nx-glass-auth__lang">
        <UiLanguageSwitch compact />
      </div>
      <div className="nx-glass-card nx-glass-auth__card">
        <div className="nx-glass-auth__brand">
          <img className="nx-glass-auth__logo" src={logoSrc} alt="NodexPro" />
          <h1 className="nx-glass-title">{t('auth.createAccount')}</h1>
        </div>
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
            <Link className="nx-glass-link" to="/login">
              {t('auth.signIn')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
