import { config } from '../config.js';
import type { RequestContext } from './context.js';
import { forbidden } from './errors.js';

export interface PlatformOwnerIdentity {
  email: string;
  phone: string | null;
  hasPasswordCredential: boolean;
  hasAccessKeyCredential: boolean;
}

function getConfiguredPlatformOwnerIdentity(): PlatformOwnerIdentity | null {
  if (!config.platformOwner.email) {
    return null;
  }
  return {
    email: config.platformOwner.email,
    phone: config.platformOwner.phone,
    hasPasswordCredential: !!config.platformOwner.passwordHash,
    hasAccessKeyCredential: !!config.platformOwner.accessKeyHash,
  };
}

/**
 * Platform-owner access is intentionally separate from tenant RBAC.
 * This guard denies any tenant-scoped request context and allows only the configured owner identity.
 */
export function assertPlatformOwner(ctx: RequestContext): PlatformOwnerIdentity {
  const ownerIdentity = getConfiguredPlatformOwnerIdentity();
  if (!ownerIdentity) {
    throw forbidden('Platform owner access is not configured', 'PLATFORM_OWNER_NOT_CONFIGURED');
  }

  const requestEmail = ctx.user.email.trim().toLowerCase();
  if (!requestEmail || requestEmail !== ownerIdentity.email) {
    throw forbidden('Platform owner access required', 'PLATFORM_OWNER_REQUIRED');
  }

  if (ctx.membership?.roleCode) {
    throw forbidden('Platform owner access must not run in tenant RBAC context', 'PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN');
  }

  return ownerIdentity;
}

/** Same success conditions as assertPlatformOwner, without throwing. Do not use for commercial owner APIs. */
export function isPlatformOwnerContext(ctx: RequestContext): boolean {
  const ownerIdentity = getConfiguredPlatformOwnerIdentity();
  if (!ownerIdentity) return false;
  const requestEmail = ctx.user.email.trim().toLowerCase();
  if (!requestEmail || requestEmail !== ownerIdentity.email) return false;
  if (ctx.membership?.roleCode) return false;
  return true;
}

export function hasConfiguredPlatformOwnerCredentials(): boolean {
  const ownerIdentity = getConfiguredPlatformOwnerIdentity();
  if (!ownerIdentity) return false;
  return ownerIdentity.hasPasswordCredential || ownerIdentity.hasAccessKeyCredential || !!ownerIdentity.phone;
}

