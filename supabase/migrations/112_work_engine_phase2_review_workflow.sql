-- Stage 10 Phase 2 — professional review workflow (policy gate + RBAC).
-- additive only

-- ---------------------------------------------------------------------------
-- work_engine_work_type_policies: review_gate
--   none     → review commands forbidden for this work_type
--   required → reviewer must be set before request_review (same as allowed for commands)
--   allowed  → review commands allowed when reviewer is set (default for existing rows)
-- ---------------------------------------------------------------------------
alter table public.work_engine_work_type_policies
  add column if not exists review_gate text not null default 'allowed'
    check (review_gate in ('none', 'required', 'allowed'));

comment on column public.work_engine_work_type_policies.review_gate is
  'Work Engine Phase 2: whether request_review / approve / reject apply to this work_type.';

-- ---------------------------------------------------------------------------
-- RBAC — review.request / approve / reject / break_glass
--   staff: request + approve + reject (commands enforce assignee vs reviewer vs break_glass)
--   admin: all + break_glass
--   owner: all + break_glass
--   viewer: none
-- ---------------------------------------------------------------------------
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner',  'work_engine.review.request'),
  ('owner',  'work_engine.review.approve'),
  ('owner',  'work_engine.review.reject'),
  ('owner',  'work_engine.review.break_glass'),
  ('admin',  'work_engine.review.request'),
  ('admin',  'work_engine.review.approve'),
  ('admin',  'work_engine.review.reject'),
  ('admin',  'work_engine.review.break_glass'),
  ('staff',  'work_engine.review.request'),
  ('staff',  'work_engine.review.approve'),
  ('staff',  'work_engine.review.reject')
on conflict (role_code, permission_code) do nothing;
