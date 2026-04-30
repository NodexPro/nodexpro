-- Phase 1: Seed plans and modules (registry only; no business modules).

insert into public.plans (id, code, name, is_active) values
  ('c0000000-0000-4000-8000-000000000001', 'starter', 'Starter', true),
  ('c0000000-0000-4000-8000-000000000002', 'pro', 'Pro', true),
  ('c0000000-0000-4000-8000-000000000003', 'enterprise', 'Enterprise', true)
on conflict (code) do nothing;

-- Placeholder modules (foundation only; no CRM/payroll/VAT)
-- modules: unique on code
insert into public.modules (id, code, name, description, scope_type, is_active, is_sellable, default_visibility) values
  ('d0000000-0000-4000-8000-000000000001', 'core', 'Core', 'Platform core', 'global', true, false, 'visible'),
  ('d0000000-0000-4000-8000-000000000002', 'dashboard', 'Dashboard', 'Overview and home', 'global', true, false, 'visible'),
  ('d0000000-0000-4000-8000-000000000003', 'settings', 'Settings', 'Organization and user settings', 'global', true, false, 'visible'),
  ('d0000000-0000-4000-8000-000000000004', 'users_roles', 'Users & Roles', 'Member and role management', 'global', true, false, 'visible'),
  ('d0000000-0000-8000-0000-000000000005', 'billing', 'Billing', 'Subscription and billing', 'global', true, true, 'visible')
on conflict (code) do nothing;

-- Plan_modules: starter has core + dashboard + settings + users_roles; pro adds billing; enterprise same as pro for now
insert into public.plan_modules (plan_id, module_id)
select p.id, m.id from public.plans p, public.modules m
where p.code = 'starter' and m.code in ('core', 'dashboard', 'settings', 'users_roles')
on conflict (plan_id, module_id) do nothing;

insert into public.plan_modules (plan_id, module_id)
select p.id, m.id from public.plans p, public.modules m
where p.code in ('pro', 'enterprise') and m.code in ('core', 'dashboard', 'settings', 'users_roles', 'billing')
on conflict (plan_id, module_id) do nothing;
