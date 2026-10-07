import type { NextFunction, Request, Response } from 'express';
import { assertCanAccessClientFromContext } from '../domains/client-operations/organization-client-access.js';

/**
 * Enforce canonical client access for routes with `:clientId` before handlers run.
 * Scope is derived from authenticated membership — never from request body/query.
 */
export function requireAuthorizedClientParam(paramName = 'clientId') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context;
      if (!ctx?.organizationId || !ctx.user?.id) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      const clientId = String(req.params[paramName] ?? '').trim();
      if (!clientId) {
        return res.status(400).json({ code: 'BAD_REQUEST', message: `${paramName} required` });
      }
      await assertCanAccessClientFromContext(ctx, clientId);
      return next();
    } catch (e) {
      return next(e);
    }
  };
}
