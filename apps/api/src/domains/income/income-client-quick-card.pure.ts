/**
 * Pure builders for Work Engine invoices Client Quick Card.
 * Backend owns identity rows + DocFlow invite action eligibility.
 * Frontend renders only returned rows/actions (no population branching).
 */

import type {
  IncomeClientDocumentManagementPopulationKey,
  IncomeClientQuickCard,
  IncomeClientQuickCardAction,
  IncomeClientQuickCardRow,
} from './income.types.js';

const EMPTY_DISPLAY = '—';

export type ClientQuickCardIdentity = {
  display_name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  business_type: string | null;
  contact_person: string | null;
};

export type ClientQuickCardDocflowInviteState = {
  /** Module entitlement / RBAC gate for DocFlow invite. */
  module_entitled: boolean;
  invite_status: 'not_invited' | 'invited' | 'joined' | 'expired' | 'revoked';
};

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function identityRow(params: {
  key: string;
  label: string;
  raw: string | null | undefined;
  copyable: boolean;
}): IncomeClientQuickCardRow {
  const raw = trimOrNull(params.raw);
  const display = raw ?? EMPTY_DISPLAY;
  return {
    key: params.key,
    label: params.label,
    display_value: display,
    copy_value: params.copyable && raw ? raw : null,
    copy_enabled: Boolean(params.copyable && raw),
  };
}

/** Build identity rows shared by both populations (omit only when product requires). */
export function buildClientQuickCardIdentityRows(
  identity: ClientQuickCardIdentity,
): IncomeClientQuickCardRow[] {
  return [
    identityRow({
      key: 'client_name',
      label: 'שם לקוח',
      raw: identity.display_name,
      copyable: true,
    }),
    identityRow({
      key: 'tax_id',
      label: 'ח.פ / ע.מ',
      raw: identity.tax_id,
      copyable: true,
    }),
    identityRow({
      key: 'email',
      label: 'אימייל',
      raw: identity.email,
      copyable: true,
    }),
    identityRow({
      key: 'phone',
      label: 'טלפון',
      raw: identity.phone,
      copyable: true,
    }),
    identityRow({
      key: 'business_type',
      label: 'סוג עסק',
      raw: identity.business_type,
      copyable: false,
    }),
    identityRow({
      key: 'contact_person',
      label: 'איש קשר',
      raw: identity.contact_person,
      copyable: false,
    }),
  ];
}

/**
 * Mirrors DocFlow invites management status resolution
 * (portal active / invite accepted → joined; pending + expired → expired; etc.).
 */
export function resolveClientQuickCardDocflowInviteStatus(params: {
  portalStatus: string | null;
  inviteStatus: string | null;
  tokenExpiresAt: string | null;
}): ClientQuickCardDocflowInviteState['invite_status'] {
  if (params.portalStatus === 'active' || params.inviteStatus === 'accepted') return 'joined';
  if (params.inviteStatus === 'revoked') return 'revoked';
  if (params.inviteStatus === 'pending') {
    const expiresAt = params.tokenExpiresAt ? new Date(params.tokenExpiresAt).getTime() : null;
    if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return 'expired';
    }
    return 'invited';
  }
  return 'not_invited';
}

/**
 * DocFlow invite action for office-client Quick Cards only.
 * Uses existing command `invite_client_to_docflow` and existing status semantics.
 */
export function buildOfficeClientDocflowInviteAction(params: {
  clientId: string;
  email: string | null;
  phone: string | null;
  docflow: ClientQuickCardDocflowInviteState;
}): IncomeClientQuickCardAction {
  const hasPhone = Boolean(trimOrNull(params.phone));
  const hasEmail = Boolean(trimOrNull(params.email));
  const hasAnyChannel = hasPhone || hasEmail;
  const status = params.docflow.invite_status;

  if (!params.docflow.module_entitled) {
    return {
      action_key: 'invite_to_docflow',
      label: 'הזמנה ל-DocFlow',
      enabled: false,
      disabled_reason: 'מודול DocFlow אינו זמין לארגון',
      state_key: 'permission_denied',
      command: null,
      command_payload: {},
    };
  }

  const canInvite =
    hasAnyChannel && (status === 'not_invited' || status === 'expired' || status === 'revoked');

  let state_key: string;
  let disabled_reason: string | null = null;
  if (canInvite) {
    state_key = 'available';
  } else if (!hasAnyChannel) {
    state_key = 'unavailable';
    disabled_reason = 'כדי להזמין את הלקוח ל-DocFlow, יש להוסיף טלפון או אימייל בפרטי הלקוח.';
  } else if (status === 'invited') {
    state_key = 'invitation_sent';
    disabled_reason = 'הזמנה כבר נשלחה';
  } else if (status === 'joined') {
    state_key = 'connected';
    disabled_reason = 'הלקוח כבר מחובר ל-DocFlow';
  } else {
    state_key = 'unavailable';
    disabled_reason = 'לא זמין כעת';
  }

  return {
    action_key: 'invite_to_docflow',
    label: 'הזמנה ל-DocFlow',
    enabled: canInvite,
    disabled_reason,
    state_key,
    command: canInvite ? 'invite_client_to_docflow' : null,
    command_payload: canInvite
      ? {
          client_id: params.clientId,
        }
      : {},
  };
}

export function buildOfficeClientQuickCard(params: {
  clientId: string;
  identity: ClientQuickCardIdentity;
  docflow: ClientQuickCardDocflowInviteState;
}): IncomeClientQuickCard {
  return {
    enabled: true,
    client_id: params.clientId,
    population_key: 'office_client',
    rows: buildClientQuickCardIdentityRows(params.identity),
    actions: [
      buildOfficeClientDocflowInviteAction({
        clientId: params.clientId,
        email: params.identity.email,
        phone: params.identity.phone,
        docflow: params.docflow,
      }),
    ],
  };
}

export function buildEndCustomerQuickCard(params: {
  incomeCustomerId: string;
  identity: ClientQuickCardIdentity;
}): IncomeClientQuickCard {
  return {
    enabled: true,
    client_id: params.incomeCustomerId,
    population_key: 'office_client_customer' satisfies IncomeClientDocumentManagementPopulationKey,
    rows: buildClientQuickCardIdentityRows(params.identity),
    /** DocFlow invite must not appear for end customers — omit entirely. */
    actions: [],
  };
}
