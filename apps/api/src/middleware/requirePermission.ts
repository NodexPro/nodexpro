import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../shared/errors.js';

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const perms = req.context?.membership?.permissions ?? [];
    const hasAny = permissions.some((p) => perms.includes(p));
    if (!hasAny) {
      next(forbidden('Insufficient permission'));
      return;
    }
    next();
  };
}
