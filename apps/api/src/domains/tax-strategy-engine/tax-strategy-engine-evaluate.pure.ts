import { taxRulePayloadChecksum } from '../tax-knowledge/tax-knowledge-checksum.pure.js';
import type { TaxCalculationResultAggregate } from '../tax-calculation-engine/tax-calculation-engine-commands.types.js';
import type {
  TaxRuleEngineBlocking,
  TaxRuleEngineBlockingLinkedRequirement,
  TaxRuleEngineClassification,
  TaxRuleEngineEvaluatedRule,
  TaxRuleEngineEvaluationAggregate,
  TaxRuleEngineUnresolvedLegalReference,
} from '../tax-rule-engine/tax-rule-engine.types.js';
import {
  TAX_STRATEGY_ENGINE_EVALUATION_KEY,
  TAX_STRATEGY_FINDING_SEVERITY_BY_CODE,
  TAX_STRATEGY_STATUS_BY_SEVERITY,
  TAX_STRATEGY_STATUS_PRECEDENCE,
  type TaxStrategyAttachedCalculation,
  type TaxStrategyEvaluateInput,
  type TaxStrategyEvaluation,
  type TaxStrategyFinding,
  type TaxStrategyFindingCode,
  type TaxStrategyMemberEvaluation,
  type TaxStrategyStatus,
  type TaxStrategyVersionInput,
} from './tax-strategy-engine.types.js';

const IN_PLAY: readonly TaxStrategyStatus[] = [
  'available',
  'legally_constrained',
  'judgment_required',
];

const K4_MISSING_INPUT_CODES = new Set(['missing_input', 'missing_legal_value']);

type TreRuleIndex = Map<string, TaxRuleEngineEvaluatedRule>;

function cmpText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function finding(
  code: TaxStrategyFindingCode,
  extras: Omit<TaxStrategyFinding, 'code' | 'severity'> = {},
): TaxStrategyFinding {
  return {
    code,
    severity: TAX_STRATEGY_FINDING_SEVERITY_BY_CODE[code],
    ...extras,
  };
}

export function statusFromFindings(findings: readonly TaxStrategyFinding[]): TaxStrategyStatus {
  let best: TaxStrategyStatus = 'available';
  let bestPrecedence = TAX_STRATEGY_STATUS_PRECEDENCE.length;
  for (const row of findings) {
    if (row.severity === 'info') continue;
    const status = TAX_STRATEGY_STATUS_BY_SEVERITY[row.severity];
    const precedence = TAX_STRATEGY_STATUS_PRECEDENCE.indexOf(status);
    if (precedence >= 0 && precedence < bestPrecedence) {
      best = status;
      bestPrecedence = precedence;
    }
  }
  return best;
}

function sortFindings(findings: TaxStrategyFinding[]): TaxStrategyFinding[] {
  return [...findings].sort((left, right) => {
    return (
      cmpText(left.code, right.code) ||
      cmpText(left.tax_rule_version_id, right.tax_rule_version_id) ||
      cmpText(left.relationship_id, right.relationship_id) ||
      cmpText(left.unresolved_legal_reference_id, right.unresolved_legal_reference_id) ||
      cmpText(left.calculation_definition_version_id, right.calculation_definition_version_id) ||
      cmpText(left.exclusive_group_id, right.exclusive_group_id) ||
      cmpText((left.peer_strategy_version_ids ?? []).join(','), (right.peer_strategy_version_ids ?? []).join(','))
    );
  });
}

function sortMembers(members: TaxStrategyMemberEvaluation[]): TaxStrategyMemberEvaluation[] {
  return [...members].sort((left, right) => {
    return cmpText(left.strategy_code, right.strategy_code) || cmpText(left.strategy_version_id, right.strategy_version_id);
  });
}

function indexTreRules(tre: TaxRuleEngineEvaluationAggregate): TreRuleIndex {
  const index: TreRuleIndex = new Map();
  for (const row of [...tre.applicable, ...tre.not_applicable, ...tre.undetermined]) {
    if (!index.has(row.tax_rule_version_id)) {
      index.set(row.tax_rule_version_id, row);
    }
  }
  return index;
}

function lookupClassification(
  index: TreRuleIndex,
  taxRuleVersionId: string,
): TaxRuleEngineClassification | null {
  return index.get(taxRuleVersionId)?.classification ?? null;
}

function collectRequiredAndProhibited(
  strategy: TaxStrategyVersionInput,
  index: TreRuleIndex,
  treMatchesEvaluation: boolean,
): TaxStrategyFinding[] {
  const findings: TaxStrategyFinding[] = [];
  for (const pin of strategy.required_rule_pins) {
    if (!treMatchesEvaluation) {
      findings.push(finding('required_rule_not_evaluated', { tax_rule_version_id: pin.tax_rule_version_id }));
      continue;
    }
    const classification = lookupClassification(index, pin.tax_rule_version_id);
    if (classification === null) {
      findings.push(finding('required_rule_not_evaluated', { tax_rule_version_id: pin.tax_rule_version_id }));
      continue;
    }
    if (classification === 'not_applicable') {
      findings.push(finding('required_rule_not_applicable', { tax_rule_version_id: pin.tax_rule_version_id }));
      continue;
    }
    if (classification === 'undetermined') {
      const missing = uniqueSorted(index.get(pin.tax_rule_version_id)?.missing_facts ?? []);
      findings.push(
        finding('missing_facts', {
          tax_rule_version_id: pin.tax_rule_version_id,
          missing_facts: missing,
        }),
      );
    }
  }

  for (const pin of strategy.prohibited_rule_pins ?? []) {
    if (!treMatchesEvaluation) continue;
    if (lookupClassification(index, pin.tax_rule_version_id) === 'applicable') {
      findings.push(finding('prohibited_rule_applicable', { tax_rule_version_id: pin.tax_rule_version_id }));
    }
  }
  return findings;
}

function overlayCode(effect: string): TaxStrategyFindingCode | null {
  switch (effect) {
    case 'conflict':
      return 'conflict';
    case 'exception':
      return 'exception';
    case 'override':
      return 'override';
    case 'unmet_dependency':
      return 'unmet_dependency';
    case 'unmet_companion':
      return 'unmet_companion';
    case 'unmet_procedure':
      return 'unmet_procedure';
    case 'unresolved_dependency':
      return 'unresolved_legal_reference_blocking';
    default:
      return null;
  }
}

function collectOverlays(
  strategy: TaxStrategyVersionInput,
  tre: TaxRuleEngineEvaluationAggregate,
  index: TreRuleIndex,
  treMatchesEvaluation: boolean,
): TaxStrategyFinding[] {
  if (!treMatchesEvaluation) return [];
  const required = new Set(strategy.required_rule_pins.map((pin) => pin.tax_rule_version_id));
  const findings: TaxStrategyFinding[] = [];
  const blockingIds = new Set<string>();

  const consider = (fromId: string) => required.has(fromId) && index.has(fromId);

  for (const row of tre.blocking as TaxRuleEngineBlocking[]) {
    if (!consider(row.from_tax_rule_version_id)) continue;
    const code = overlayCode(row.effect);
    if (!code) continue;
    findings.push(
      finding(code, {
        tax_rule_version_id: row.from_tax_rule_version_id,
        relationship_id: row.relationship_id,
      }),
    );
  }

  for (const row of tre.blocking_linked_requirements as TaxRuleEngineBlockingLinkedRequirement[]) {
    if (!consider(row.from_tax_rule_version_id)) continue;
    const code = overlayCode(row.effect);
    if (!code) continue;
    if (row.unresolved_legal_reference_id) {
      blockingIds.add(row.unresolved_legal_reference_id);
    }
    findings.push(
      finding(code, {
        tax_rule_version_id: row.from_tax_rule_version_id,
        relationship_id: row.relationship_id,
        unresolved_legal_reference_id: row.unresolved_legal_reference_id,
      }),
    );
  }

  for (const row of tre.unresolved_legal_references as TaxRuleEngineUnresolvedLegalReference[]) {
    if (row.status !== 'open') continue;
    if (!consider(row.from_tax_rule_version_id)) continue;
    if (row.id && blockingIds.has(row.id)) continue;
    findings.push(
      finding('unresolved_legal_reference', {
        tax_rule_version_id: row.from_tax_rule_version_id,
        unresolved_legal_reference_id: row.id,
      }),
    );
  }

  return findings;
}

function k4BlockingCodes(agg: TaxCalculationResultAggregate): string[] {
  return uniqueSorted(agg.blocking.map((row) => row.code));
}

function collectCalculations(
  strategy: TaxStrategyVersionInput,
  supplied: TaxCalculationResultAggregate[],
  countryCode: string,
  asOf: string,
): { findings: TaxStrategyFinding[]; calculations: TaxStrategyAttachedCalculation[] } {
  const findings: TaxStrategyFinding[] = [];
  const calculations: TaxStrategyAttachedCalculation[] = [];

  for (const pin of strategy.calculation_pins ?? []) {
    const versionId = pin.calculation_definition_version_id;
    const candidates = supplied.filter(
      (row) => row.definition?.calculation_definition_version_id === versionId,
    );
    if (candidates.length === 0) {
      findings.push(finding('calculation_not_supplied', { calculation_definition_version_id: versionId }));
      continue;
    }
    const matched = candidates.find((row) => row.country_code === countryCode && row.as_of === asOf);
    if (!matched) {
      findings.push(finding('calculation_pin_mismatch', { calculation_definition_version_id: versionId }));
      continue;
    }

    const codes = k4BlockingCodes(matched);
    const missingInput =
      matched.status === 'blocked' &&
      (codes.some((code) => K4_MISSING_INPUT_CODES.has(code)) || matched.missing_inputs.length > 0);

    if (missingInput) {
      findings.push(
        finding('calculation_missing_inputs', {
          calculation_definition_version_id: versionId,
          k4_blocking_codes: codes,
          missing_facts: uniqueSorted(matched.missing_inputs),
        }),
      );
    } else if (matched.status === 'blocked') {
      findings.push(
        finding('calculation_blocked', {
          calculation_definition_version_id: versionId,
          k4_blocking_codes: codes,
        }),
      );
    }

    if (matched.status === 'calculated' || (matched.status === 'blocked' && !missingInput)) {
      calculations.push({
        calculation_definition_version_id: versionId,
        status: matched.status,
        result: matched.result,
        result_checksum: matched.result_checksum,
        k4_blocking_codes: codes,
      });
    }
  }

  return { findings, calculations };
}

function applyExclusiveGroups(members: TaxStrategyMemberEvaluation[]): void {
  const groups = new Map<string, TaxStrategyMemberEvaluation[]>();
  for (const member of members) {
    if (!member.exclusive_group_id) continue;
    const list = groups.get(member.exclusive_group_id) ?? [];
    list.push(member);
    groups.set(member.exclusive_group_id, list);
  }

  for (const [groupId, group] of [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (group.length < 2) continue;
    const provisional = new Map(group.map((member) => [member.strategy_version_id, statusFromFindings(member.findings)]));
    const inPlay = group.filter((member) => IN_PLAY.includes(provisional.get(member.strategy_version_id)!));
    const unevaluable = group.filter((member) => provisional.get(member.strategy_version_id) === 'unevaluable');

    if (unevaluable.length > 0 && inPlay.length > 0) {
      const peerIds = uniqueSorted(unevaluable.map((member) => member.strategy_version_id));
      for (const member of inPlay) {
        member.findings.push(
          finding('exclusive_group_peer_not_resolved', {
            exclusive_group_id: groupId,
            peer_strategy_version_ids: peerIds,
          }),
        );
      }
      continue;
    }

    if (inPlay.length >= 2) {
      for (const member of inPlay) {
        const peers = uniqueSorted(
          inPlay
            .filter((row) => row.strategy_version_id !== member.strategy_version_id)
            .map((row) => row.strategy_version_id),
        );
        member.findings.push(
          finding('exclusive_group_collision', {
            exclusive_group_id: groupId,
            peer_strategy_version_ids: peers,
          }),
        );
      }
    }
  }
}

function memberPayload(member: TaxStrategyMemberEvaluation): Record<string, unknown> {
  return {
    calculations: member.calculations,
    country_code: member.country_code,
    exclusive_group_id: member.exclusive_group_id,
    findings: member.findings,
    status: member.status,
    strategy_code: member.strategy_code,
    strategy_id: member.strategy_id,
    strategy_version_id: member.strategy_version_id,
  };
}

export function taxStrategyEvaluationChecksum(evaluation: Omit<TaxStrategyEvaluation, 'evaluation_checksum'>): string {
  return taxRulePayloadChecksum({
    as_of: evaluation.as_of,
    country_code: evaluation.country_code,
    evaluation_key: evaluation.evaluation_key,
    members: evaluation.members.map(memberPayload),
  });
}

export function evaluateTaxStrategies(input: TaxStrategyEvaluateInput): TaxStrategyEvaluation {
  const index = indexTreRules(input.rule_evaluation);
  const treMatchesEvaluation =
    input.rule_evaluation.country_code === input.country_code && input.rule_evaluation.as_of === input.as_of;

  const members: TaxStrategyMemberEvaluation[] = [];
  const strategies = [...input.strategies].filter((row) => row.country_code === input.country_code);

  for (const strategy of strategies) {
    const findings = [
      ...collectRequiredAndProhibited(strategy, index, treMatchesEvaluation),
      ...collectOverlays(strategy, input.rule_evaluation, index, treMatchesEvaluation),
    ];
    if (strategy.requires_professional_judgment === true) {
      findings.push(finding('requires_professional_judgment'));
    }
    const calc = collectCalculations(strategy, input.calculations ?? [], input.country_code, input.as_of);
    findings.push(...calc.findings);
    members.push({
      strategy_id: strategy.strategy_id,
      strategy_version_id: strategy.strategy_version_id,
      strategy_code: strategy.strategy_code,
      country_code: strategy.country_code,
      exclusive_group_id: strategy.exclusive_group_id ?? null,
      status: 'available',
      findings,
      calculations: calc.calculations.sort((left, right) =>
        left.calculation_definition_version_id.localeCompare(right.calculation_definition_version_id),
      ),
    });
  }

  applyExclusiveGroups(members);

  for (const member of members) {
    member.findings = sortFindings(member.findings);
    member.status = statusFromFindings(member.findings);
  }

  const sorted = sortMembers(members);
  const body = {
    evaluation_key: TAX_STRATEGY_ENGINE_EVALUATION_KEY,
    country_code: input.country_code,
    as_of: input.as_of,
    members: sorted,
  };
  return {
    ...body,
    evaluation_checksum: taxStrategyEvaluationChecksum(body),
  };
}
