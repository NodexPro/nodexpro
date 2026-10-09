import type { RequestContext } from './context.js';
import { forbidden } from './errors.js';
import { roleHasOfficeClientAccess } from '../domains/client-operations/organization-client-access.pure.js';

/** Service-layer twin of requireOfficeAdministration. Direct calls cannot skip the route. */
export function assertOfficeAdministration(ctx: RequestContext): void {
  if (!roleHasOfficeClientAccess(ctx.membership?.roleCode)) {
    throw forbidden('Office administration required', 'OFFICE_ADMIN_REQUIRED');
  }
}
