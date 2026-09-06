import { badRequest } from '../../shared/errors.js';
import {
  evaluateTaxCalculationWithContext,
  parseTaxCalculationExecutionContext,
} from './tax-calculation-engine-context.pure.js';
import {
  CALCULATE_TAX_PAYLOAD_FIELDS,
  TAX_CALCULATION_RESULT_AGGREGATE_KEY,
  type TaxCalculationEngineCommandResponse,
} from './tax-calculation-engine-commands.types.js';
import { buildTaxCalculationResultAggregate } from './tax-calculation-engine-result.pure.js';
import { validateTaxCalculationExpression } from './tax-calculation-engine-validate.pure.js';

const TENANT_SCOPE_FIELDS = ['organization_id', 'client_id'] as const;

export function parseCalculateTaxCommandPayload(payload: Record<string, unknown>): {
  expression: unknown;
  context: Record<string, unknown>;
} {
  for (const field of TENANT_SCOPE_FIELDS) {
    if (field in payload) {
      throw badRequest(`calculate_tax does not accept ${field}`);
    }
  }
  const allowed = new Set<string>(CALCULATE_TAX_PAYLOAD_FIELDS);
  const unexpected = Object.keys(payload)
    .filter((key) => !allowed.has(key))
    .sort((a, b) => a.localeCompare(b));
  if (unexpected.length) {
    throw badRequest(`calculate_tax does not accept ${unexpected.join(', ')}`);
  }
  if (!('expression' in payload) || payload.expression === undefined || payload.expression === null) {
    throw badRequest('expression is required');
  }
  const expressionCheck = validateTaxCalculationExpression(payload.expression);
  if (!expressionCheck.ok) {
    throw badRequest(expressionCheck.message);
  }

  const context: Record<string, unknown> = {};
  for (const field of CALCULATE_TAX_PAYLOAD_FIELDS) {
    if (field === 'expression' || !(field in payload)) continue;
    context[field] = payload[field];
  }
  const parsed = parseTaxCalculationExecutionContext(context);
  if (!parsed.ok) {
    throw badRequest(parsed.blocked.message);
  }
  return { expression: payload.expression, context };
}

export function runCalculateTax(payload: Record<string, unknown>): TaxCalculationEngineCommandResponse {
  const parsed = parseCalculateTaxCommandPayload(payload);
  const contextParsed = parseTaxCalculationExecutionContext(parsed.context);
  if (!contextParsed.ok) {
    throw badRequest(contextParsed.blocked.message);
  }
  const evaluation = evaluateTaxCalculationWithContext({
    context: parsed.context,
    expression: parsed.expression,
  });
  const aggregate = buildTaxCalculationResultAggregate(contextParsed.value, evaluation);
  return {
    ok: true,
    command: 'calculate_tax',
    refreshed: {
      aggregate_key: TAX_CALCULATION_RESULT_AGGREGATE_KEY,
      aggregate,
    },
  };
}
