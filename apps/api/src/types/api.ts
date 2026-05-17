// DTOs and API types. Frontend consumes these; no business logic here.

export type UiLanguageCode = 'en' | 'he';

export interface SidebarAccountBlockModel {
  organization_name: string | null;
  user_display_name: string;
  user_email: string;
  organization_switcher: {
    visible: boolean;
    label: string;
    organizations: Array<{ organization_id: string; name: string; selected: boolean }>;
  };
  language_selector: {
    label: string;
    current_value: UiLanguageCode;
    options: Array<{ value: UiLanguageCode; label: string }>;
  };
  logout_action: {
    label: string;
    command_key: 'logout';
  };
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    status: string;
  };
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  permissions: string[];
  enabledModules: string[];
  /** Nav items for sidebar: core routes only (no /m/* module apps). */
  navItems: { path: string; label: string; order: number }[];
  /** Active module apps shown under Modules in sidebar. */
  moduleAppNavItems?: { path: string; label: string }[];
  /** Ready-to-render sidebar account block (session aggregate). */
  sidebar_account_block: SidebarAccountBlockModel;
}

export type AuthSessionState =
  | 'platform_owner'
  | 'needs_onboarding'
  | 'needs_org_selection'
  | 'ready'
  | 'blocked';

export interface AuthSessionAggregateResponse extends MeResponse {
  session_state: AuthSessionState;
  redirect_to: string;
  allowed_actions: string[];
}

export type EntitlementStatus = 'not_entitled' | 'entitled' | 'trial' | 'expired' | 'restricted';
export type ActivationStatus = 'inactive' | 'activating' | 'active' | 'suspended' | 'deactivated';

export interface ModulePlanLimitDto {
  limitCode: string;
  limitValue: number | null;
  isUnlimited: boolean;
}

export interface ModulePlanItemDto {
  id: string;
  code: string;
  name: string;
  billingPeriod: string;
  currency: string;
  priceAmount: number;
  sortOrder: number;
  limits: ModulePlanLimitDto[];
}

export interface ModuleSubscriptionItemDto {
  id: string;
  modulePlanId: string;
  planName: string;
  currency: string;
  priceAmount: number;
  status: string;
  startedAt: string;
  endsAt: string | null;
}

export interface ModuleStateItem {
  moduleId: string;
  code: string;
  name: string;
  version: string;
  scopeType: string;
  category: string | null;
  dependencies: string[];
  entitlementStatus: EntitlementStatus;
  activationStatus: ActivationStatus;
  canActivate: boolean;
  canDeactivate: boolean;
  blockReason: string | null;
  navPath: string | null;
  navLabel: string | null;
  navOrder: number;
  isSystem: boolean;
  availablePlans: ModulePlanItemDto[];
  currentSubscription: ModuleSubscriptionItemDto | null;
  canSelectPlan: boolean;
  canChangePlan: boolean;
}

export interface TrialStateDto {
  hasLegalIdentity: boolean;
  trialStatus: 'none' | 'not_started' | 'trialing' | 'trial_expired' | 'converted' | 'blocked';
  startedAt: string | null;
  endsAt: string | null;
  blocked: boolean;
}

export interface ModulesStateResponse {
  trialState: TrialStateDto;
  modules: ModuleStateItem[];
}

export interface CreateOrganizationBody {
  name: string;
  legalName?: string;
  countryCode: string;
  timezone?: string;
}

/** Response from POST /organizations. Enough for frontend to set context and refetch /me. */
export interface CreateOrganizationResponse {
  id: string;
  name: string;
  /** Same as id for create flow; set as X-Organization-Id when calling /me. */
  activeOrganizationId: string;
  /** Confirms current user was added as member (admin role). */
  membershipCreated: boolean;
}

export interface SetActiveOrgBody {
  organizationId: string;
}

export interface AddMemberBody {
  userId: string;
  roleId: string;
}

export interface UpdateMemberBody {
  roleId?: string;
}
