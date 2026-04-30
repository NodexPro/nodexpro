import { forbidden } from '../shared/errors.js';
export function requirePermission(...permissions) {
    return (req, _res, next) => {
        const perms = req.context?.membership?.permissions ?? [];
        const hasAny = permissions.some((p) => perms.includes(p));
        if (!hasAny) {
            next(forbidden('Insufficient permission'));
            return;
        }
        next();
    };
}
