import { supabaseAdmin } from '../../db/client.js';
import { TRIAL_MONTHS } from '../trial/trial.service.js';
import {
  LANDING_MODULE_SHOWCASE_DEFINITIONS,
  buildLandingModuleShowcase,
  type LandingModuleShowcaseAggregate,
  type LandingShowcaseModuleRow,
  type LandingShowcasePlanRow,
} from './landing-module-showcase.pure.js';

/** Public, read-only, tenant-agnostic catalog read (no organization data involved). */
export async function getLandingModuleShowcase(): Promise<LandingModuleShowcaseAggregate> {
  const codes = LANDING_MODULE_SHOWCASE_DEFINITIONS.map((d) => d.module_code);
  const { data: modules, error: modulesError } = await supabaseAdmin
    .from('modules')
    .select('id, code, name, is_active, is_sellable')
    .in('code', codes);
  if (modulesError) throw modulesError;

  const rows = (modules ?? []) as Array<LandingShowcaseModuleRow & { id: string }>;
  const idToCode = new Map(rows.map((m) => [m.id, m.code]));

  let plans: LandingShowcasePlanRow[] = [];
  if (rows.length > 0) {
    const { data: planRows, error: plansError } = await supabaseAdmin
      .from('module_plans')
      .select('module_id, currency, price_amount, billing_period, sort_order, is_active')
      .in('module_id', rows.map((m) => m.id))
      .eq('is_active', true);
    if (plansError) throw plansError;
    plans = (planRows ?? []).flatMap((p) => {
      const code = idToCode.get(p.module_id as string);
      if (!code) return [];
      return [
        {
          module_code: code,
          currency: String(p.currency).trim(),
          price_amount: Number(p.price_amount),
          billing_period: String(p.billing_period),
          sort_order: Number(p.sort_order ?? 0),
          is_active: Boolean(p.is_active),
        },
      ];
    });
  }

  return buildLandingModuleShowcase({ modules: rows, plans, trialMonths: TRIAL_MONTHS });
}
