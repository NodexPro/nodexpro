import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/I18nProvider';
import { PublicAuthShell } from '../components/auth/PublicAuthShell';
import { deviceSignOutOptions } from '../lib/device-session.pure';
import {
  authConfirmPublicState,
  destinationAfterAuthConfirm,
  isRecoveryAuthConfirmType,
  parseAuthConfirmLocation,
  recoveryHandoffHref,
  stripAuthSensitiveUrl,
} from '../lib/auth-confirm.pure';

export function AuthConfirm() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const parsed = parseAuthConfirmLocation(window.location.search, window.location.hash);
    const publicState = authConfirmPublicState(parsed);

    async function finish(ok: boolean) {
      if (cancelled) return;
      window.history.replaceState(null, '', stripAuthSensitiveUrl(window.location.href));
      if (!ok) {
        setFailed(true);
        return;
      }
      await supabase.auth.signOut(deviceSignOutOptions()).catch(() => undefined);
      if (cancelled) return;
      navigate(destinationAfterAuthConfirm(parsed.type), { replace: true });
    }

    async function run() {
      if (isRecoveryAuthConfirmType(parsed.type)) {
        window.location.replace(recoveryHandoffHref(window.location.search, window.location.hash));
        return;
      }
      if (publicState.hasError) {
        await finish(false);
        return;
      }
      if (publicState.hasTokenHash && parsed.type && parsed.tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.type,
        });
        await finish(!error);
        return;
      }
      if (publicState.hasCode && parsed.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
        await finish(!error);
        return;
      }
      const first = await supabase.auth.getSession();
      if (first.data.session) {
        await finish(true);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      if (cancelled) return;
      const second = await supabase.auth.getSession();
      await finish(Boolean(second.data.session));
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <PublicAuthShell title={t('auth.confirmEmailTitle')} testId="nx-auth-confirm">
      {failed ? (
        <>
          <p className="nx-glass-alert nx-glass-alert--error" role="alert">
            {t('auth.confirmEmailFailed')}
          </p>
          <div className="nx-glass-auth__links">
            <Link className="nx-glass-link" to="/login">
              {t('auth.backToSignIn')}
            </Link>
          </div>
        </>
      ) : (
        <p className="nx-glass-copy" role="status">
          {t('auth.confirmingEmail')}
        </p>
      )}
    </PublicAuthShell>
  );
}
