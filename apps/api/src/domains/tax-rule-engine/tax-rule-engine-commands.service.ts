import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { buildTaxRuleEngineEvaluationAggregate } from './tax-rule-engine-read-models.service.js';
import {
  isTaxRuleEngineCommand,
  parseEvaluateTaxRulesInput,
  TAX_RULE_ENGINE_AGGREGATE_KEY,
  type TaxRuleEngineCommandName,
  type TaxRuleEngineCommandResponse,
} from './tax-rule-engine.types.js';

export { isTaxRuleEngineCommand, TAX_RULE_ENGINE_COMMANDS } from './tax-rule-engine.types.js';

async function handleEvaluateTaxRules(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<TaxRuleEngineCommandResponse> {
  const input = parseEvaluateTaxRulesInput(payload);
  const aggregate = await buildTaxRuleEngineEvaluationAggregate(ctx, input);
  return {
    ok: true,
    command: 'evaluate_tax_rules',
    refreshed: {
      aggregate_key: TAX_RULE_ENGINE_AGGREGATE_KEY,
      aggregate,
    },
  };
}

export async function executeTaxRuleEngineCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<TaxRuleEngineCommandResponse> {
  assertPlatformOwner(ctx);

  if (!isTaxRuleEngineCommand(command)) {
    throw badRequest(`Unsupported tax-rule-engine command: ${command || 'unknown'}`);
  }

  const name: TaxRuleEngineCommandName = command;
  switch (name) {
    case 'evaluate_tax_rules':
      return handleEvaluateTaxRules(ctx, payload);
    default:
      throw badRequest(`Unsupported tax-rule-engine command: ${command}`);
  }
}
