import { supabaseAdmin } from '../../db/client.js';
const activateHooks = new Map();
export function registerModuleActivateHook(moduleCode, fn) {
    activateHooks.set(moduleCode, fn);
}
export async function runModuleActivateHook(ctx) {
    const fn = activateHooks.get(ctx.moduleCode);
    if (!fn)
        return { success: true };
    try {
        await fn(ctx);
        return { success: true };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, error: message };
    }
}
const deactivateHooks = new Map();
export function registerModuleDeactivateHook(moduleCode, fn) {
    deactivateHooks.set(moduleCode, fn);
}
export async function runModuleDeactivateHook(ctx) {
    const fn = deactivateHooks.get(ctx.moduleCode);
    if (!fn)
        return { success: true };
    try {
        await fn(ctx);
        return { success: true };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, error: message };
    }
}
/** Example module: create default organization_module_settings row. */
export function registerExampleModuleHook() {
    registerModuleActivateHook('example', async (ctx) => {
        const { data: existing } = await supabaseAdmin
            .from('organization_module_settings')
            .select('id')
            .eq('organization_id', ctx.organizationId)
            .eq('module_id', ctx.moduleId)
            .eq('key', 'initialized')
            .single();
        if (existing)
            return;
        await supabaseAdmin.from('organization_module_settings').insert({
            organization_id: ctx.organizationId,
            module_id: ctx.moduleId,
            key: 'initialized',
            value_json: { at: new Date().toISOString(), version: '1.0.0' },
        });
    });
}
