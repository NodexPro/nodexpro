import { supabaseAdmin } from '../../db/client.js';

export type DocflowRequestTemplateItemRow = {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
};

export type DocflowRequestTemplateAggregateRow = {
  id: string;
  country_code: string;
  name: string;
  items: DocflowRequestTemplateItemRow[];
};

export async function fetchDocflowRequestTemplatesForOwner(): Promise<DocflowRequestTemplateAggregateRow[]> {
  const { data: defs, error: dErr } = await supabaseAdmin
    .from('docflow_request_template_definitions')
    .select('id, country_code, name')
    .is('archived_at', null)
    .order('country_code', { ascending: true })
    .order('name', { ascending: true });
  if (dErr) throw dErr;
  const templates = defs ?? [];
  if (!templates.length) return [];

  const ids = templates.map((t) => String(t.id));
  const { data: items, error: iErr } = await supabaseAdmin
    .from('docflow_request_template_definition_items')
    .select('id, template_definition_id, sort_order, label, description')
    .in('template_definition_id', ids)
    .order('sort_order', { ascending: true });
  if (iErr) throw iErr;
  const byTpl = new Map<string, DocflowRequestTemplateItemRow[]>();
  for (const row of items ?? []) {
    const tid = String(row.template_definition_id);
    const list = byTpl.get(tid) ?? [];
    list.push({
      id: String(row.id),
      label: String(row.label ?? '').trim(),
      description: row.description != null ? String(row.description) : null,
      sort_order: Number(row.sort_order ?? 0),
    });
    byTpl.set(tid, list);
  }
  return templates.map((t) => ({
    id: String(t.id),
    country_code: String(t.country_code ?? '').trim().toUpperCase().slice(0, 2),
    name: String(t.name ?? '').trim(),
    items: byTpl.get(String(t.id)) ?? [],
  }));
}

export async function resolveOrganizationCountryCode(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('country_code')
    .eq('id', orgId)
    .maybeSingle();
  if (error) throw error;
  const cc = String((data as { country_code?: string } | null)?.country_code ?? '').trim().toUpperCase().slice(0, 2);
  return cc.length >= 2 ? cc : null;
}

export async function fetchDocflowRequestTemplatesForOrgCountry(countryCode: string): Promise<DocflowRequestTemplateAggregateRow[]> {
  const cc = countryCode.trim().toUpperCase().slice(0, 2);
  if (cc.length < 2) return [];
  const { data: defs, error: dErr } = await supabaseAdmin
    .from('docflow_request_template_definitions')
    .select('id, country_code, name')
    .eq('country_code', cc)
    .is('archived_at', null)
    .order('name', { ascending: true });
  if (dErr) throw dErr;
  const templates = defs ?? [];
  if (!templates.length) return [];

  const ids = templates.map((t) => String(t.id));
  const { data: items, error: iErr } = await supabaseAdmin
    .from('docflow_request_template_definition_items')
    .select('id, template_definition_id, sort_order, label, description')
    .in('template_definition_id', ids)
    .order('sort_order', { ascending: true });
  if (iErr) throw iErr;
  const byTpl = new Map<string, DocflowRequestTemplateItemRow[]>();
  for (const row of items ?? []) {
    const tid = String(row.template_definition_id);
    const list = byTpl.get(tid) ?? [];
    list.push({
      id: String(row.id),
      label: String(row.label ?? '').trim(),
      description: row.description != null ? String(row.description) : null,
      sort_order: Number(row.sort_order ?? 0),
    });
    byTpl.set(tid, list);
  }
  return templates.map((t) => ({
    id: String(t.id),
    country_code: String(t.country_code ?? '').trim().toUpperCase().slice(0, 2),
    name: String(t.name ?? '').trim(),
    items: byTpl.get(String(t.id)) ?? [],
  }));
}
