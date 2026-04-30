import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';

/** Returns dependency module codes for a module (direct dependencies). */
export async function getDependencyCodes(moduleId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('module_dependencies')
    .select('depends_on_module_id, modules(code)')
    .eq('module_id', moduleId);
  if (!data?.length) return [];
  return data
    .map((r) =>
      supabaseEmbedOne((r as unknown as { modules: { code: string } | { code: string }[] | null }).modules)?.code
    )
    .filter(Boolean) as string[];
}

/** Returns dependency module IDs for a module. */
export async function getDependencyModuleIds(moduleId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('module_dependencies')
    .select('depends_on_module_id')
    .eq('module_id', moduleId);
  if (!data?.length) return [];
  return data.map((r: { depends_on_module_id: string }) => r.depends_on_module_id);
}

/** Check if all dependencies are active for this org. Returns list of missing dependency codes. */
export async function getMissingActiveDependencies(
  organizationId: string,
  dependencyModuleIds: string[]
): Promise<string[]> {
  if (dependencyModuleIds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('organization_modules')
    .select('module_id, modules(code)')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('module_id', dependencyModuleIds);
  const activeIds = new Set((data ?? []).map((r: { module_id: string }) => r.module_id));
  const missingIds = dependencyModuleIds.filter((id) => !activeIds.has(id));
  const codes: string[] = [];
  for (const id of missingIds) {
    const codeRow = await supabaseAdmin.from('modules').select('code').eq('id', id).single();
    if (codeRow.data) codes.push(codeRow.data.code);
  }
  return codes;
}

/** Topological sort of module IDs by dependencies. Fails if cycle. */
export function topologicalSort(moduleIds: string[], depsMap: Map<string, string[]>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(id: string): void {
    if (temp.has(id)) throw new Error('Cycle in module dependencies');
    if (visited.has(id)) return;
    temp.add(id);
    for (const dep of depsMap.get(id) ?? []) {
      if (moduleIds.includes(dep)) visit(dep);
    }
    temp.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of moduleIds) {
    visit(id);
  }
  return result;
}
