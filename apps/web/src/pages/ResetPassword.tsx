import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * After reset link: Supabase redirects with hash (implicit) or ?code= (PKCE).
 * Auth client emits PASSWORD_RECOVERY or establishes a session we can use with updateUser.
 */
export function ResetPassword() {
  const navigate = useNavigate();
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
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw new Error(updErr.message);
      await supabase.auth.signOut();
      navigate('/login', { replace: true, state: { passwordResetOk: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setLoading(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
        <h1>Set new password</h1>
        <p style={{ color: '#6b7280' }}>Verifying reset link…</p>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
        <h1>Set new password</h1>
        <p style={{ color: '#b91c1c' }}>
          This reset link is invalid or has expired. Request a new one from the sign-in page.
        </p>
        <p style={{ marginTop: 16 }}>
          <Link to="/forgot-password">Forgot password</Link>
          {' · '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Set new password</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save password'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
