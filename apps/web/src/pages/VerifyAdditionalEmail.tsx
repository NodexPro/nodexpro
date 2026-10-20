import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiJsonPublic } from '../api/client';
import { AUTH } from '../api/endpoints';
import '../styles/nx-glass-surface.css';

export function VerifyAdditionalEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('Verifying additional email…');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('This verification link is missing a token.');
      return;
    }
    apiJsonPublic<{ ok?: boolean }>(AUTH.verifyAdditionalLoginEmail, {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus('ok');
        setMessage('Additional login email verified. You can sign in with it now.');
      })
      .catch((error) => {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Verification failed.');
      });
  }, [token]);

  return (
    <div className="nx-glass-auth" data-testid="nx-verify-additional-email">
      <div className="nx-glass-card nx-glass-auth__card">
        <h1 className="nx-glass-title">Additional email</h1>
        <p className={status === 'error' ? 'nx-glass-alert nx-glass-alert--error' : 'nx-glass-subtitle'}>{message}</p>
        <p>
          <Link className="nx-glass-link" to="/login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
