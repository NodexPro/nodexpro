import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../shared/errors.js';
import { roleHasOfficeClientAccess } from '../domains/client-operations/organization-client-access.pure.js';

/** Owner/Admin office administration. Staff/Viewer fail even when a legacy permission bit matches. */
export function requireOfficeAdministration(req: Request, _res: Response, next: NextFunction): void {
  if (!roleHasOfficeClientAccess(req.context?.membership?.roleCode)) {
    next(forbidden('Office administration required', 'OFFICE_ADMIN_REQUIRED'));
    return;
  }
  next();
}
