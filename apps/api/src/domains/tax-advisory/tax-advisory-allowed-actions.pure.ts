import {
  TAX_ADVISORY_COMMANDS,
  TAX_ADVISORY_LIFECYCLE_ARCHIVED,
  TAX_ADVISORY_LIFECYCLE_DRAFT,
  type TaxAdvisoryAllowedAction,
  type TaxAdvisoryCommandName,
} from './tax-advisory.types.js';

export function taxAdvisoryImplementedCommands(): readonly TaxAdvisoryCommandName[] {
  return TAX_ADVISORY_COMMANDS;
}

export function buildTaxAdvisoryAllowedActions(input: {
  canEdit: boolean;
  hasOpenCase: boolean;
  lifecycleState: string | null;
}): TaxAdvisoryAllowedAction[] {
  const draft = input.hasOpenCase && input.lifecycleState === TAX_ADVISORY_LIFECYCLE_DRAFT;
  const archived = input.hasOpenCase && input.lifecycleState === TAX_ADVISORY_LIFECYCLE_ARCHIVED;

  const createReason = !input.canEdit
    ? 'insufficient_permission'
    : input.hasOpenCase
      ? 'open_case_exists'
      : null;
  const mutateReason = !input.canEdit
    ? 'insufficient_permission'
    : !input.hasOpenCase
      ? 'case_absent'
      : archived
        ? 'case_archived'
        : !draft
          ? 'case_not_draft'
          : null;

  return [
    {
      action_key: 'create_tax_advisory_case',
      enabled: Boolean(input.canEdit && !input.hasOpenCase),
      reason: createReason,
    },
    {
      action_key: 'set_tax_advisory_case_fact',
      enabled: Boolean(input.canEdit && draft),
      reason: mutateReason,
    },
    {
      action_key: 'clear_tax_advisory_case_fact',
      enabled: Boolean(input.canEdit && draft),
      reason: mutateReason,
    },
    {
      action_key: 'archive_tax_advisory_case',
      enabled: Boolean(input.canEdit && draft),
      reason: mutateReason,
    },
  ];
}

export function advertisedActionsAreImplemented(actions: TaxAdvisoryAllowedAction[]): boolean {
  const implemented = new Set<string>(TAX_ADVISORY_COMMANDS);
  return actions.every((action) => implemented.has(action.action_key));
}
