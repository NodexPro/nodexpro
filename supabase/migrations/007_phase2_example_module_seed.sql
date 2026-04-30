-- Phase 2: Example module seed. One test module for activation/dependency flow.

insert into public.modules (
  id, code, name, description, scope_type, is_active, is_sellable, default_visibility,
  version, category, schema_version, migration_version, nav_label, nav_path, nav_order
) values (
  'e0000000-0000-4000-8000-000000000001',
  'example',
  'Example Module',
  'Phase 2 test module for activation and nav',
  'global',
  true,
  true,
  'hidden',
  '1.0.0',
  'productivity',
  '1',
  '0',
  'Example',
  '/m/example',
  100
) on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  version = excluded.version,
  category = excluded.category,
  nav_label = excluded.nav_label,
  nav_path = excluded.nav_path,
  nav_order = excluded.nav_order;

-- Add example to starter plan so orgs can activate it
insert into public.plan_modules (plan_id, module_id)
select p.id, m.id from public.plans p, public.modules m
where p.code = 'starter' and m.code = 'example'
on conflict (plan_id, module_id) do nothing;
