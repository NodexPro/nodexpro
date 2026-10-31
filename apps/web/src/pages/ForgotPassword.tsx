import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AUTH } from '../api/endpoints';
import { apiJsonPublic } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { PublicAuthShell } from '../components/auth/PublicAuthShell';

export function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const emailNorm = email.trim().toLowerCase();
      if (!emailNorm) {
        setError(t('auth.emailRequired'));
        setLoading(false);
        return;
      }
      await apiJsonPublic(AUTH.requestPasswordReset, {
        method: 'POST',
        body: JSON.stringify({
          email: emailNorm,
          redirect_to: `${window.location.origin}/reset-password`,
        }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.requestFailed'));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <PublicAuthShell title={t('auth.checkEmail')} testId="nx-forgot-password">
        <p className="nx-glass-muted">{t('auth.checkEmailBody')}</p>
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

  return (
    <PublicAuthShell title={t('auth.resetTitle')} testId="nx-forgot-password">
      <p className="nx-glass-muted" style={{ marginBottom: 16 }}>
        {t('auth.resetLead')}
      </p>
      <form onSubmit={handleSubmit} aria-busy={loading}>
        <div className="nx-glass-field">
          <label className="nx-glass-label" htmlFor="email">
            {t('auth.email')}
          </label>
          <input
            id="email"
            className="nx-glass-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        {error && (
          <p className="nx-glass-alert nx-glass-alert--error" role="alert">
            {error}
          </p>
        )}
        <button className="nx-glass-btn nx-glass-btn--purple" type="submit" disabled={loading}>
          {loading ? t('auth.sendingReset') : t('auth.sendResetLink')}
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
