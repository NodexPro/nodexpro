-- Module-based commerce seed: system modules + commercial modules + module_plans + limits.

-- ========== SYSTEM MODULES ==========
update public.modules set is_system = true, is_sellable = false
where code in ('core', 'dashboard', 'settings', 'users_roles', 'billing');

-- ========== COMMERCIAL MODULES ==========
insert into public.modules (id, code, name, description, scope_type, is_active, is_sellable, default_visibility, version, category, is_system) values
  ('f1000000-0000-4000-8000-000000000001', 'clients', 'Client Management', 'Manage clients and contacts', 'global', true, true, 'visible', '1.0.0', 'crm', false),
  ('f1000000-0000-4000-8000-000000000002', 'invoice', 'Invoice / Hashboniot', 'Invoicing and hashboniot', 'global', true, true, 'visible', '1.0.0', 'billing', false),
  ('f1000000-0000-4000-8000-000000000003', 'accounting', 'Accounting', 'Accounting module', 'global', true, true, 'visible', '1.0.0', 'finance', false),
  ('f1000000-0000-4000-8000-000000000004', 'payroll', 'Payroll', 'Payroll module', 'global', true, true, 'visible', '1.0.0', 'hr', false),
  ('f1000000-0000-4000-8000-000000000005', 'reminder', 'Global Reminder', 'Global reminders', 'global', true, true, 'visible', '1.0.0', 'productivity', false)
on conflict (code) do update set name = excluded.name, description = excluded.description, is_sellable = excluded.is_sellable, is_system = excluded.is_system;

-- ========== CLIENT MANAGEMENT PLANS ==========
insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, '100_clients', 'Up to 100 clients', 'month', 'ILS', 120, 1 from public.modules where code = 'clients' limit 1
on conflict (module_id, code) do update set name = excluded.name, price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_clients', 100, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'clients' and mp.code = '100_clients'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, '500_clients', 'Up to 500 clients', 'month', 'ILS', 170, 2 from public.modules where code = 'clients' limit 1
on conflict (module_id, code) do update set name = excluded.name, price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_clients', 500, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'clients' and mp.code = '500_clients'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'unlimited', 'Unlimited clients', 'month', 'ILS', 199, 3 from public.modules where code = 'clients' limit 1
on conflict (module_id, code) do update set name = excluded.name, price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, is_unlimited)
select mp.id, 'max_clients', true from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'clients' and mp.code = 'unlimited'
on conflict (module_plan_id, limit_code) do nothing;

-- ========== INVOICE MODULE ==========
insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'unlimited', 'Unlimited', 'month', 'ILS', 60, 1 from public.modules where code = 'invoice' limit 1
on conflict (module_id, code) do update set name = excluded.name, price_amount = excluded.price_amount;

-- ========== ACCOUNTING PLANS ==========
insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, '100_clients', 'Up to 100 clients', 'month', 'ILS', 270, 1 from public.modules where code = 'accounting' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_clients', 100, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'accounting' and mp.code = '100_clients'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, '300_clients', 'Up to 300 clients', 'month', 'ILS', 299, 2 from public.modules where code = 'accounting' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_clients', 300, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'accounting' and mp.code = '300_clients'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, '500_clients', 'Up to 500 clients', 'month', 'ILS', 319, 3 from public.modules where code = 'accounting' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_clients', 500, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'accounting' and mp.code = '500_clients'
on conflict (module_plan_id, limit_code) do nothing;

-- ========== PAYROLL PLANS ==========
insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'tier1', '2 companies / 1-5 employees each', 'month', 'ILS', 99, 1 from public.modules where code = 'payroll' limit 1
on conflict (module_id, code) do update set name = excluded.name, price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_companies', 2, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier1'
on conflict (module_plan_id, limit_code) do nothing;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_employees_per_company', 5, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier1'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'tier2', '5 companies / up to 10 employees each', 'month', 'ILS', 125, 2 from public.modules where code = 'payroll' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_companies', 5, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier2'
on conflict (module_plan_id, limit_code) do nothing;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_employees_per_company', 10, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier2'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'tier3', '7 companies / up to 10 employees each', 'month', 'ILS', 199, 3 from public.modules where code = 'payroll' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_companies', 7, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier3'
on conflict (module_plan_id, limit_code) do nothing;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_employees_per_company', 10, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier3'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'tier4', '20 companies / up to 30 employees each', 'month', 'ILS', 299, 4 from public.modules where code = 'payroll' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_companies', 20, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier4'
on conflict (module_plan_id, limit_code) do nothing;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_employees_per_company', 30, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier4'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'tier5', '50 companies / up to 30 employees each', 'month', 'ILS', 399, 5 from public.modules where code = 'payroll' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_companies', 50, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier5'
on conflict (module_plan_id, limit_code) do nothing;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_employees_per_company', 30, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier5'
on conflict (module_plan_id, limit_code) do nothing;

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'tier6', '100 companies / up to 40 employees each', 'month', 'ILS', 499, 6 from public.modules where code = 'payroll' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_companies', 100, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier6'
on conflict (module_plan_id, limit_code) do nothing;
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'max_employees_per_company', 40, false from public.module_plans mp join public.modules m on m.id = mp.module_id where m.code = 'payroll' and mp.code = 'tier6'
on conflict (module_plan_id, limit_code) do nothing;

-- ========== GLOBAL REMINDER ==========
insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select id, 'standard', 'Standard', 'month', 'USD', 29, 1 from public.modules where code = 'reminder' limit 1
on conflict (module_id, code) do update set price_amount = excluded.price_amount;
