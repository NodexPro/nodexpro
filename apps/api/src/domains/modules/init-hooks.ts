import { supabaseAdmin } from '../../db/client.js';

export interface ModuleActivateContext {
  organizationId: string;
  moduleId: string;
  moduleCode: string;
}

type OnActivateHook = (ctx: ModuleActivateContext) => Promise<void>;

const activateHooks = new Map<string, OnActivateHook>();

export function registerModuleActivateHook(moduleCode: string, fn: OnActivateHook): void {
  activateHooks.set(moduleCode, fn);
}

export async function runModuleActivateHook(ctx: ModuleActivateContext): Promise<{ success: boolean; error?: string }> {
  const fn = activateHooks.get(ctx.moduleCode);
  if (!fn) return { success: true };
  try {
    await fn(ctx);
    return { success: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}

export interface ModuleDeactivateContext {
  organizationId: string;
  moduleId: string;
  moduleCode: string;
}

type OnDeactivateHook = (ctx: ModuleDeactivateContext) => Promise<void>;

const deactivateHooks = new Map<string, OnDeactivateHook>();

export function registerModuleDeactivateHook(moduleCode: string, fn: OnDeactivateHook): void {
  deactivateHooks.set(moduleCode, fn);
}

export async function runModuleDeactivateHook(ctx: ModuleDeactivateContext): Promise<{ success: boolean; error?: string }> {
  const fn = deactivateHooks.get(ctx.moduleCode);
  if (!fn) return { success: true };
  try {
    await fn(ctx);
    return { success: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}

/** Example module: create default organization_module_settings row. */
export function registerExampleModuleHook(): void {
  registerModuleActivateHook('example', async (ctx) => {
    const { data: existing } = await supabaseAdmin
      .from('organization_module_settings')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('module_id', ctx.moduleId)
      .eq('key', 'initialized')
      .single();
    if (existing) return;
    await supabaseAdmin.from('organization_module_settings').insert({
      organization_id: ctx.organizationId,
      module_id: ctx.moduleId,
      key: 'initialized',
      value_json: { at: new Date().toISOString(), version: '1.0.0' },
    });
  });
}
