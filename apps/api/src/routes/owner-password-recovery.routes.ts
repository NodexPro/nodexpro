import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  completePlatformOwnerPasswordReset,
  requestPlatformOwnerRecovery,
  verifyPlatformOwnerRecoveryOtp,
} from '../domains/auth/platform-owner-password-recovery.service.js';

const router = Router();

router.post(
  '/request',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => req.ip ?? 'unknown',
    code: 'OWNER_RECOVERY_RATE_LIMIT',
    message: 'Too many recovery requests. Please try again later.',
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const out = await requestPlatformOwnerRecovery({
        email,
        ipAddress: req.ip ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      return res.json({
        ok: true,
        recovery_session_id: out.recovery_session_id,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/verify',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyGenerator: (req) => req.ip ?? 'unknown',
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const recovery_session_id =
        typeof req.body?.recovery_session_id === 'string' ? req.body.recovery_session_id : '';
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const out = await verifyPlatformOwnerRecoveryOtp({
        recovery_session_id,
        code,
        ipAddress: req.ip ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      return res.json({ ok: true, ...out });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/complete',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.ip ?? 'unknown',
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const recovery_session_id =
        typeof req.body?.recovery_session_id === 'string' ? req.body.recovery_session_id : '';
      const new_password = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
      const out = await completePlatformOwnerPasswordReset({
        recovery_session_id,
        new_password,
        ipAddress: req.ip ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      return res.json(out);
    } catch (e) {
      next(e);
    }
  }
);

export const ownerPasswordRecoveryRoutes = router;
