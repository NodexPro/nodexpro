import type { Request } from 'express';

export type UiLanguageCode = 'en' | 'he';

export interface AppUser {
  id: string;
  authUserId: string;
  email: string;
  fullName: string | null;
  status: string;
  uiLanguage: UiLanguageCode | null;
}

export interface OrgMembership {
  organizationId: string;
  userId: string;
  roleId: string;
  roleCode: string;
  permissions: string[];
}

export interface RequestContext {
  user: AppUser;
  membership: OrgMembership | null;
  organizationId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

export function getContext(req: Request): RequestContext | undefined {
  return req.context;
}

export function getRequiredOrgId(req: Request): string {
  const ctx = req.context;
  if (!ctx?.organizationId) throw new Error('Organization context required');
  return ctx.organizationId;
}
