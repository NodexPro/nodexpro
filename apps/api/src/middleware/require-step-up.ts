import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../db/client.js';
import { classifySensitiveCommand, decideSensitiveCommandStepUp } from '../shared/step-up-auth.pure.js';
import { unauthorized } from '../shared/errors.js';

export function requireSensitiveStepUp() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const path = String(req.originalUrl ?? req.path ?? '').split('?')[0];
      const commandClass = classifySensitiveCommand(path);
      if (commandClass === 'ordinary') return next();
      const assurance = req.context?.authenticatorAssurance === 'aal2' ? 'aal2' : 'aal1';
      let mfaEnrolled = false;
      const authUserId = req.context?.user.authUserId;
      if (authUserId) {
        const factors = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: authUserId }).catch(() => null);
        mfaEnrolled = (factors?.data?.factors ?? []).some((factor) => factor.status === 'verified');
      }
      const decision = decideSensitiveCommandStepUp({ commandClass, assurance, mfaEnrolled });
      if (decision === 'require_aal2') {
        next(unauthorized('A fresh authenticator code is required', 'MFA_REQUIRED'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
