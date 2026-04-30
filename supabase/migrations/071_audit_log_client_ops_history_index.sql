-- Speed up client history read model: org + module + time-ordered scans.
create index if not exists idx_audit_log_org_module_created
  on public.audit_log (organization_id, module_code, created_at desc);
