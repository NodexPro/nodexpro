-- Stage 1 compatibility reconciliation (DO NOT assume required on every env).
-- Additive / idempotent: for ACTIVE canonical organization_memberships rows that lack a
-- matching organization_users row, insert a legacy OU row so temporary readers stay aligned.
-- Does NOT override revoked/invited canonical status. Does NOT delete OU rows.
-- Safe to re-run.

insert into public.organization_users (
  organization_id,
  user_id,
  role_id,
  membership_status,
  invited_by,
  joined_at,
  created_at,
  updated_at
)
select
  om.organization_id,
  om.user_id,
  r.id as role_id,
  'active'::text as membership_status,
  om.invited_by,
  coalesce(om.joined_at, om.created_at, now()) as joined_at,
  coalesce(om.created_at, now()) as created_at,
  now() as updated_at
from public.organization_memberships om
join public.roles r on r.code = om.role_code
where om.status = 'active'
  and not exists (
    select 1
    from public.organization_users ou
    where ou.organization_id = om.organization_id
      and ou.user_id = om.user_id
  );

-- Align legacy OU status when canonical is revoked but OU still active (P0 drift repair).
update public.organization_users ou
set
  membership_status = 'removed',
  updated_at = now()
from public.organization_memberships om
where ou.organization_id = om.organization_id
  and ou.user_id = om.user_id
  and om.status = 'revoked'
  and ou.membership_status = 'active';

comment on table public.organization_users is
  'LEGACY compatibility membership table. Canonical truth is organization_memberships. Migration 180 syncs OU from active canonical rows when missing.';
