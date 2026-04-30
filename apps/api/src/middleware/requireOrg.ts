import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../shared/errors.js';

export function requireOrg(req: Request, _res: Response, next: NextFunction): void {
  if (!req.context?.organizationId || !req.context.membership) {
    next(forbidden('Active organization required'));
    return;
  }
  next();
}
