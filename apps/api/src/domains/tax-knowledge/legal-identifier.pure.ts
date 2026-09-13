export type LegalIdentifier = {
  base_number: string;
  letter_suffix: string | null;
  nested_components: string[];
  source_display_identifier: string;
  normalized_machine_identifier: string;
};

export type LegalIdentifierFields = {
  source_display_identifier: string | null;
  normalized_machine_identifier: string | null;
  identifier_base_number: string | null;
  identifier_letter_suffix: string | null;
  identifier_nested_components: string[];
};

export type CanonicalLegalIdentity = {
  country_code: string;
  tax_source_id: string;
  parent_id: string | null;
  kind_id: string;
  normalized_machine_identifier: string | null;
};

export type StagingLegalIdentity = {
  job_id?: string | null;
  document_id?: string | null;
  parent_id: string | number | null;
  kind_label: string;
  normalized_machine_identifier: string | null;
  node_number?: string | null;
};

const IDENTIFIER_RE = /^(\d{1,4})([א-ת])?((?:\([^()]+\))*)$/u;

export function reconstructLegalMachineIdentifier(
  baseNumber: string,
  letterSuffix: string | null,
  nestedComponents: string[],
): string {
  return `${baseNumber}${letterSuffix ?? ''}${nestedComponents.map((part) => `(${part})`).join('')}`;
}

export function parseNestedComponentValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) return [];
    out.push(item);
  }
  return out;
}

export function parseLegalIdentifier(raw: string): LegalIdentifier | null {
  const source = raw.trim();
  if (!source) return null;
  const compact = source.replace(/\s+/g, '');
  const match = compact.match(IDENTIFIER_RE);
  if (match) {
    const baseNumber = match[1];
    const letterSuffix = match[2] || null;
    const nested: string[] = [];
    const parenRe = /\(([^()]+)\)/g;
    let part: RegExpExecArray | null;
    while ((part = parenRe.exec(match[3] ?? ''))) {
      if (!part[1]) return null;
      nested.push(part[1]);
    }
    return {
      base_number: baseNumber,
      letter_suffix: letterSuffix,
      nested_components: nested,
      source_display_identifier: source,
      normalized_machine_identifier: reconstructLegalMachineIdentifier(baseNumber, letterSuffix, nested),
    };
  }
  if (/[()]/.test(compact)) return null;
  return {
    base_number: compact,
    letter_suffix: null,
    nested_components: [],
    source_display_identifier: source,
    normalized_machine_identifier: compact,
  };
}

export function legalIdentifierFromFields(fields: {
  source_display_identifier?: string | null;
  normalized_machine_identifier?: string | null;
  identifier_base_number?: string | null;
  identifier_letter_suffix?: string | null;
  identifier_nested_components?: unknown;
}): LegalIdentifier | null {
  const source = fields.source_display_identifier?.trim() || null;
  const machine = fields.normalized_machine_identifier?.trim() || null;
  const base = fields.identifier_base_number?.trim() || null;
  const letter = fields.identifier_letter_suffix?.trim() || null;
  const nested = parseNestedComponentValues(fields.identifier_nested_components);
  if (source && machine && base) {
    return {
      base_number: base,
      letter_suffix: letter,
      nested_components: nested,
      source_display_identifier: source,
      normalized_machine_identifier: machine,
    };
  }
  if (source) return parseLegalIdentifier(source);
  return null;
}

export function legalIdentifierFields(parsed: LegalIdentifier | null): LegalIdentifierFields {
  if (!parsed) {
    return {
      source_display_identifier: null,
      normalized_machine_identifier: null,
      identifier_base_number: null,
      identifier_letter_suffix: null,
      identifier_nested_components: [],
    };
  }
  return {
    source_display_identifier: parsed.source_display_identifier,
    normalized_machine_identifier: parsed.normalized_machine_identifier,
    identifier_base_number: parsed.base_number,
    identifier_letter_suffix: parsed.letter_suffix,
    identifier_nested_components: parsed.nested_components,
  };
}

export function displayLegalIdentifier(
  sourceDisplayIdentifier: string | null | undefined,
  legacyNodeNumber?: string | null,
): string | null {
  return sourceDisplayIdentifier?.trim() || legacyNodeNumber?.trim() || null;
}

export function sameCanonicalLegalIdentity(left: CanonicalLegalIdentity, right: CanonicalLegalIdentity): boolean {
  if (!left.normalized_machine_identifier || !right.normalized_machine_identifier) return false;
  return (
    left.country_code === right.country_code &&
    left.tax_source_id === right.tax_source_id &&
    (left.parent_id ?? null) === (right.parent_id ?? null) &&
    left.kind_id === right.kind_id &&
    left.normalized_machine_identifier === right.normalized_machine_identifier
  );
}

export function findCanonicalIdentityConflict(
  candidate: CanonicalLegalIdentity,
  existing: CanonicalLegalIdentity[],
  ignoreId?: string | null,
): CanonicalLegalIdentity | null {
  return (
    existing.find((row, index) => {
      if (ignoreId && 'id' in row && String((row as CanonicalLegalIdentity & { id?: string }).id) === ignoreId) {
        return false;
      }
      void index;
      return sameCanonicalLegalIdentity(candidate, row);
    }) ?? null
  );
}

export function stagingIdentityKey(row: StagingLegalIdentity): string | null {
  const machine = row.normalized_machine_identifier?.trim() || null;
  const fallback = row.node_number?.trim() || null;
  const token = machine || fallback;
  if (!token) return null;
  return [
    row.job_id ?? '',
    row.document_id ?? '',
    String(row.parent_id ?? 'root'),
    row.kind_label,
    token,
  ].join('::');
}

export function sameStagingLegalIdentity(left: StagingLegalIdentity, right: StagingLegalIdentity): boolean {
  const leftKey = stagingIdentityKey(left);
  const rightKey = stagingIdentityKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function identifierPayloadForCanonicalCreate(row: LegalIdentifierFields): LegalIdentifierFields {
  return legalIdentifierFields(legalIdentifierFromFields(row));
}
