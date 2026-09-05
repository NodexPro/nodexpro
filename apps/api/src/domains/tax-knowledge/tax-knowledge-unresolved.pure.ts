import {
  TAX_RULE_RELATIONSHIP_TYPES,
  type TaxRuleRelationshipType,
} from './tax-knowledge.types.js';

const OPERATIONAL_UNRESOLVED_BLOCKING_INTENTS = [
  'depends_on',
  'exception_to',
  'overrides',
  'applies_with',
  'calculation_basis',
] as const;

export type UnresolvedActivationRow = {
  status: string;
  relationship_intent: string;
  activation_critical: boolean | null;
};

export function isTaxRuleRelationshipType(value: string): value is TaxRuleRelationshipType {
  return (TAX_RULE_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function parseActivationCritical(
  value: unknown,
  relationshipIntent: string,
  required: boolean,
): boolean | null {
  if (relationshipIntent !== 'procedural_requirement') {
    if (value !== undefined) {
      throw new Error('activation_critical is only valid for procedural_requirement');
    }
    return null;
  }
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error('procedural_requirement requires an explicit activation_critical true or false');
    }
    return null;
  }
  if (value === true || value === false) return value;
  throw new Error('activation_critical must be true or false');
}

export function unresolvedRowBlocksActivation(row: UnresolvedActivationRow): boolean {
  if (row.status === 'draft') return true;
  if (row.status !== 'open') return false;
  if ((OPERATIONAL_UNRESOLVED_BLOCKING_INTENTS as readonly string[]).includes(row.relationship_intent)) {
    return true;
  }
  if (row.relationship_intent === 'procedural_requirement') {
    return row.activation_critical !== false;
  }
  return false;
}

export function unresolvedRowsBlockActivation(rows: UnresolvedActivationRow[]): boolean {
  return rows.some(unresolvedRowBlocksActivation);
}

export type PreK3cSchemaAbsenceKind = 'undefined_column' | 'undefined_table';

/**
 * Pre-607 compatibility only. Fail closed on permission, timeout, connection,
 * and any other PostgREST/Postgres error.
 * 42703 / PGRST204 = undefined column; 42P01 / PGRST205 = undefined table.
 */
export function isExpectedPreK3cSchemaAbsence(
  error: { code?: string | null } | null | undefined,
  kind: PreK3cSchemaAbsenceKind,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  if (kind === 'undefined_column') {
    return code === '42703' || code === 'PGRST204';
  }
  return code === '42P01' || code === 'PGRST205';
}
