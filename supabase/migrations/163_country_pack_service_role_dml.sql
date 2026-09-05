-- Country Pack / Core compatibility — service_role DML for Tax Knowledge live fixtures.
-- Not a Tax Brain 600–699 migration.
-- Does not alter 001, 002, 086, or 600–606.
-- Does not grant tenant roles, change RLS, or touch country_legal_value_versions.

grant select, insert, update on table public.countries to service_role;
grant select, insert on table public.country_packs to service_role;
grant select, insert on table public.country_pack_rulesets to service_role;
grant select, insert on table public.country_legal_values to service_role;
