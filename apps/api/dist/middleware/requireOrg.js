import { forbidden } from '../shared/errors.js';
export function requireOrg(req, _res, next) {
    if (!req.context?.organizationId || !req.context.membership) {
        next(forbidden('Active organization required'));
        return;
    }
    next();
}
