export const TAX_STRATEGY_ENGINE_COMMANDS = [
  'create_tax_strategy',
  'update_tax_strategy_metadata',
  'create_tax_strategy_exclusive_group',
  'update_tax_strategy_exclusive_group',
  'create_tax_strategy_version',
  'update_tax_strategy_version_draft',
  'activate_tax_strategy_version',
  'retire_tax_strategy_version',
  'close_tax_strategy_version_effective_to',
  'supersede_tax_strategy_version',
  'pin_tax_strategy_version_rule',
  'unpin_tax_strategy_version_rule',
  'pin_tax_strategy_version_calculation',
  'unpin_tax_strategy_version_calculation',
] as const;

export type TaxStrategyEngineCommandName = (typeof TAX_STRATEGY_ENGINE_COMMANDS)[number];

export function isTaxStrategyEngineCommand(command: string): command is TaxStrategyEngineCommandName {
  return (TAX_STRATEGY_ENGINE_COMMANDS as readonly string[]).includes(command);
}

export const STRATEGY_ENGINE_SLICE_KEY = 'strategy_engine' as const;

export type OwnerTaxStrategySupersessionPair = {
  new_tax_strategy_version_id: string;
  old_tax_strategy_version_id: string;
};

export type OwnerTaxStrategyAllowedAction = {
  action_key: TaxStrategyEngineCommandName;
  enabled: boolean;
  payload: Record<string, string>;
  candidates?: OwnerTaxStrategySupersessionPair[];
};
