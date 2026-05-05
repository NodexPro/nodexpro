import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { refetchMe } = useAuth();
  const redirectParam = new URLSearchParams(location.search).get('redirect');
  const from = redirectParam ?? (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';
  const passwordResetOk = Boolean((location.state as { passwordResetOk?: boolean } | null)?.passwordResetOk);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const emailNorm = email.trim().toLowerCase();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: emailNorm,
        password,
      });
      if (signInError) throw new Error(signInError.message);
      if (!data.session) throw new Error('No session after sign in');

      const me = await refetchMe();
      if (!me) {
        setError('Could not load your account. Please try again.');
        setLoading(false);
        return;
      }

      if (me.organizations.length === 0) {
        navigate('/onboarding', { replace: true });
        return;
      }
      if (me.activeOrganizationId) {
        sessionStorage.setItem('activeOrganizationId', me.activeOrganizationId);
        navigate(from, { replace: true });
        return;
      }
      navigate('/select-org', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
        <button type="submit" disabled={loading}>Sign in</button>
      </form>
      <p style={{ marginTop: 12 }}>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p style={{ marginTop: 16 }}>
        <Link to="/register">Create account</Link>
      </p>
    </div>
  );
}
