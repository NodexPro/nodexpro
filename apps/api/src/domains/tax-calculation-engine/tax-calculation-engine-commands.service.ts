import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { runCalculateTax } from './tax-calculation-engine-calculate.pure.js';
import {
  isTaxCalculationEngineCommand,
  type TaxCalculationEngineCommandName,
  type TaxCalculationEngineCommandResponse,
} from './tax-calculation-engine-commands.types.js';

export { isTaxCalculationEngineCommand, TAX_CALCULATION_ENGINE_COMMANDS } from './tax-calculation-engine-commands.types.js';
export { parseCalculateTaxCommandPayload, runCalculateTax } from './tax-calculation-engine-calculate.pure.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function executeTaxCalculationCommand(
  ctx: RequestContext,
  command: string,
  payload: Record<string, unknown>,
): Promise<TaxCalculationEngineCommandResponse> {
  assertPlatformOwner(ctx);

  if (!isTaxCalculationEngineCommand(command)) {
    throw badRequest(`Unsupported tax-calculation-engine command: ${command || 'unknown'}`);
  }
  if (!isPlainObject(payload)) {
    throw badRequest('payload must be an object');
  }

  const name: TaxCalculationEngineCommandName = command;
  switch (name) {
    case 'calculate_tax':
      return runCalculateTax(payload);
    default:
      throw badRequest(`Unsupported tax-calculation-engine command: ${command}`);
  }
}
