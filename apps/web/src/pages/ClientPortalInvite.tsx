import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiDocflowPortalJson, userFacingApiMessage } from '../api/client';
import { docflowPortalAcceptInvitation } from '../api/endpoints';
import { redirectDocflowPortalToCanonicalHost } from '../lib/docflow-portal-host';
import { setDocflowPortalSessionToken } from '../lib/docflow-portal-session';

type AcceptResponse = {
  ok?: boolean;
  refreshed?: { aggregate?: Record<string, unknown> };
};

/** One in-flight accept per invite token (React Strict Mode / remount safe). */
const acceptInviteByToken = new Map<string, Promise<string>>();

function acceptInviteOnce(rawToken: string): Promise<string> {
  const existing = acceptInviteByToken.get(rawToken);
  if (existing) return existing;
  const p = (async () => {
    const out = (await apiDocflowPortalJson<AcceptResponse>(
      docflowPortalAcceptInvitation,
      { method: 'POST', body: JSON.stringify({ invite_token: decodeURIComponent(rawToken) }) },
      null
    )) as AcceptResponse;
    const agg = out.refreshed?.aggregate;
    const once = agg && typeof agg.portal_session_token_once === 'string' ? agg.portal_session_token_once : null;
    if (!once) throw new Error('תגובת השרת חסרה אסימון פורטל');
    return once;
  })().finally(() => {
    acceptInviteByToken.delete(rawToken);
  });
  acceptInviteByToken.set(rawToken, p);
  return p;
}

export function ClientPortalInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (redirectDocflowPortalToCanonicalHost()) return;
    const raw = String(token ?? '').trim();
    if (!raw) {
      setStatus('error');
      setMessage('קישור ההזמנה לא תקין.');
      return;
    }
    let cancelled = false;
    void acceptInviteOnce(raw)
      .then((once) => {
        setDocflowPortalSessionToken(once);
        if (!cancelled) navigate('/client-portal/docflow', { replace: true });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(userFacingApiMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, token]);

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100dvh', padding: 16, fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>DocFlow</h1>
        <p style={{ color: '#b91c1c', margin: 0 }}>{message}</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', padding: 16, fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>DocFlow</h1>
      <p style={{ color: '#6b7280', margin: 0 }}>מפעילים את הגישה…</p>
    </div>
  );
}
