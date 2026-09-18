import test from 'node:test';
import assert from 'node:assert/strict';
import { TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA } from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-extract-v1.js';
import {
  canOwnerApproveTaxKnowledgeProposal,
  emptyTaxKnowledgeProposalValidationCatalog,
  validateTaxKnowledgeProposalV1,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.pure.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_CALC_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_CITATION_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_CONTRACT,
  TAX_KNOWLEDGE_PROPOSAL_ENDPOINT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_FACT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_LEGAL_VALUE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_LOCAL_KEY_PATTERN,
  TAX_KNOWLEDGE_PROPOSAL_LOCATOR_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_NODE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_PARENT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_QUOTE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_RULE_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION,
  TAX_KNOWLEDGE_PROPOSAL_SUBJECT_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_KEYS,
  TAX_KNOWLEDGE_PROPOSAL_UNRESOLVED_KEYS,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-v1.types.js';
import { buildOpenAiCompatibleStructuredRequest } from '../../src/shared/ai-gateway/providers/openai-compatible.provider.js';
import type { AiGatewayResolvedConfig } from '../../src/shared/ai-gateway/ai-gateway.types.js';

type JsonSchemaNode = {
  type?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  additionalProperties?: unknown;
  required?: unknown;
  anyOf?: JsonSchemaNode[];
  $ref?: string;
  $defs?: Record<string, JsonSchemaNode>;
  enum?: unknown[];
  pattern?: string;
};

function asSchema(value: unknown): JsonSchemaNode {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonSchemaNode;
}

function resolveRef(ref: string, root: JsonSchemaNode): JsonSchemaNode {
  const prefix = '#/$defs/';
  assert.equal(ref.startsWith(prefix), true, `unsupported $ref ${ref}`);
  const name = ref.slice(prefix.length);
  const resolved = root.$defs?.[name];
  assert.ok(resolved, `missing $defs.${name}`);
  return resolved;
}

function typesOf(schema: JsonSchemaNode): string[] {
  if (Array.isArray(schema.type)) {
    return schema.type.filter((item): item is string => typeof item === 'string');
  }
  return typeof schema.type === 'string' ? [schema.type] : [];
}

function walkOpenAiStrict(schema: JsonSchemaNode, path: string, root: JsonSchemaNode, visited: Set<JsonSchemaNode>): void {
  if (visited.has(schema)) return;
  visited.add(schema);

  if (schema.$ref) {
    walkOpenAiStrict(resolveRef(schema.$ref, root), `${path}->${schema.$ref}`, root, visited);
    return;
  }

  if (schema.$defs) {
    for (const [name, def] of Object.entries(schema.$defs)) {
      walkOpenAiStrict(def, `${path}.$defs.${name}`, root, visited);
    }
  }

  if (Array.isArray(schema.anyOf)) {
    assert.ok(schema.anyOf.length > 0, `${path} anyOf must not be empty`);
    schema.anyOf.forEach((entry, index) => {
      walkOpenAiStrict(entry, `${path}.anyOf[${index}]`, root, visited);
    });
    return;
  }

  const types = typesOf(schema);
  if (types.includes('array') || schema.items) {
    assert.ok(schema.items, `${path} array is missing items`);
    walkOpenAiStrict(schema.items, `${path}.items`, root, visited);
  }

  const isObject = types.includes('object') || Boolean(schema.properties);
  if (!isObject) return;

  assert.ok(schema.properties, `${path} object is missing properties`);
  assert.equal(schema.additionalProperties, false, `${path} additionalProperties must be false`);
  assert.ok(Array.isArray(schema.required), `${path} required must be an array`);
  const propertyKeys = Object.keys(schema.properties).sort();
  const requiredKeys = [...schema.required].filter((item): item is string => typeof item === 'string').sort();
  assert.deepEqual(requiredKeys, propertyKeys, `${path} required must contain every property`);
  for (const [key, nested] of Object.entries(schema.properties)) {
    walkOpenAiStrict(nested, `${path}.properties.${key}`, root, visited);
  }
}

function collectObjectPropertyKeySets(schema: JsonSchemaNode, root: JsonSchemaNode, out: string[][], visited: Set<JsonSchemaNode>): void {
  if (visited.has(schema)) return;
  visited.add(schema);
  if (schema.$ref) {
    collectObjectPropertyKeySets(resolveRef(schema.$ref, root), root, out, visited);
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    for (const entry of schema.anyOf) collectObjectPropertyKeySets(entry, root, out, visited);
    return;
  }
  if (schema.items) collectObjectPropertyKeySets(schema.items, root, out, visited);
  if (schema.properties) {
    out.push(Object.keys(schema.properties));
    for (const nested of Object.values(schema.properties)) {
      collectObjectPropertyKeySets(nested, root, out, visited);
    }
  }
}

function firstObjectPropertyKeys(schema: JsonSchemaNode, root: JsonSchemaNode): string[] {
  const sets: string[][] = [];
  collectObjectPropertyKeySets(schema, root, sets, new Set());
  assert.ok(sets[0], 'expected an object schema');
  return sets[0] ?? [];
}

test('TAX-642F extract schema is OpenAI Structured Outputs strict', () => {
  const schema = asSchema(TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.schema);
  assert.equal(TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.name, TAX_KNOWLEDGE_PROPOSAL_CONTRACT);
  assert.deepEqual(schema.required, [...TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS]);
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  walkOpenAiStrict(schema, 'tax_knowledge_proposal_v1', schema, new Set());
});

test('TAX-642F extract schema keeps the tax_knowledge_proposal_v1 top-level contract', () => {
  const schema = asSchema(TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.schema);
  const properties = schema.properties ?? {};
  assert.deepEqual(Object.keys(properties), [...TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS]);
  assert.deepEqual(properties.schema_version?.enum, [TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION]);
  assert.deepEqual(properties.contract?.enum, [TAX_KNOWLEDGE_PROPOSAL_CONTRACT]);
});

test('TAX-642I extract schema constrains local keys with TAX-639 grammar', () => {
  const schema = asSchema(TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.schema);
  const properties = schema.properties ?? {};
  const nodeItems = asSchema(asSchema(properties.legal_nodes).items);
  const ruleItems = asSchema(asSchema(properties.rules).items);
  const calcItems = asSchema(asSchema(properties.calculations).items);
  assert.equal(nodeItems.properties?.proposal_node_key?.pattern, TAX_KNOWLEDGE_PROPOSAL_LOCAL_KEY_PATTERN);
  assert.equal(ruleItems.properties?.proposal_rule_key?.pattern, TAX_KNOWLEDGE_PROPOSAL_LOCAL_KEY_PATTERN);
  assert.equal(calcItems.properties?.proposal_calc_key?.pattern, TAX_KNOWLEDGE_PROPOSAL_LOCAL_KEY_PATTERN);
});

test('TAX-642F nested extract objects reuse TAX-639 field lists', () => {
  const schema = asSchema(TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.schema);
  const properties = schema.properties ?? {};
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.legal_nodes), schema), [...TAX_KNOWLEDGE_PROPOSAL_NODE_KEYS]);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.rules), schema), [...TAX_KNOWLEDGE_PROPOSAL_RULE_KEYS]);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.calculations), schema), [...TAX_KNOWLEDGE_PROPOSAL_CALC_KEYS]);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.facts), schema), [...TAX_KNOWLEDGE_PROPOSAL_FACT_KEYS]);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.legal_values), schema), [...TAX_KNOWLEDGE_PROPOSAL_LEGAL_VALUE_KEYS]);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.evidence), schema), [...TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_KEYS]);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(properties.uncertainties), schema), [...TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_KEYS]);

  const nodeParent = asSchema(asSchema(asSchema(properties.legal_nodes).items).properties?.parent);
  assert.deepEqual(firstObjectPropertyKeys(nodeParent, schema), [...TAX_KNOWLEDGE_PROPOSAL_PARENT_KEYS]);
  const subject = asSchema(asSchema(asSchema(properties.uncertainties).items).properties?.subject);
  assert.deepEqual(firstObjectPropertyKeys(subject, schema), [...TAX_KNOWLEDGE_PROPOSAL_SUBJECT_KEYS]);
  const quotes = asSchema(asSchema(properties.evidence).properties?.quotes);
  assert.deepEqual(firstObjectPropertyKeys(quotes, schema), [...TAX_KNOWLEDGE_PROPOSAL_QUOTE_KEYS]);
  const citations = asSchema(asSchema(properties.evidence).properties?.citations);
  assert.deepEqual(firstObjectPropertyKeys(citations, schema), [...TAX_KNOWLEDGE_PROPOSAL_CITATION_KEYS]);
  const locator = asSchema(asSchema(properties.evidence).properties?.legal_locator);
  assert.deepEqual(firstObjectPropertyKeys(locator, schema), [...TAX_KNOWLEDGE_PROPOSAL_LOCATOR_KEYS]);

  const relationshipItems = asSchema(asSchema(properties.relationships).items);
  const relationshipKeyUnion = [
    ...new Set((relationshipItems.anyOf ?? []).flatMap((entry) => Object.keys(entry.properties ?? {}))),
  ].sort();
  assert.deepEqual(relationshipKeyUnion, [...TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_KEYS].sort());
  const unresolved = relationshipItems.anyOf?.find((entry) => entry.properties && 'unresolved' in entry.properties);
  assert.ok(unresolved);
  assert.deepEqual(firstObjectPropertyKeys(asSchema(unresolved.properties?.unresolved), schema), [
    ...TAX_KNOWLEDGE_PROPOSAL_UNRESOLVED_KEYS,
  ]);
  const endpoint = asSchema(unresolved.properties?.from);
  assert.deepEqual(firstObjectPropertyKeys(endpoint, schema), [...TAX_KNOWLEDGE_PROPOSAL_ENDPOINT_KEYS]);
});

test('TAX-642F provider request still uses json_schema strict true', () => {
  const config: AiGatewayResolvedConfig = {
    provider: 'openai',
    model: 'gpt-test',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    timeoutMs: 1000,
  };
  const request = buildOpenAiCompatibleStructuredRequest({
    config,
    request: {
      purpose: 'tax_knowledge_proposal_extraction',
      messages: [{ role: 'user', content: 'x' }],
      outputSchema: {
        name: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.name,
        schema: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_JSON_SCHEMA.schema,
      },
    },
    timeoutMs: 1000,
    signal: new AbortController().signal,
  });
  const body = JSON.parse(request.body) as {
    response_format: { type: string; json_schema: { strict: boolean; name: string } };
  };
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.name, TAX_KNOWLEDGE_PROPOSAL_CONTRACT);
});

test('TAX-639 closed contract behavior is unchanged', () => {
  const draft = 'סעיף 1.';
  const closed = {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'no_rules',
    legal_nodes: [],
    rules: [],
    relationships: [],
    calculations: [],
    facts: [],
    legal_values: [],
    evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
    uncertainties: [],
  };
  const valid = validateTaxKnowledgeProposalV1({
    proposal_json: closed,
    context: {
      country_code: 'IL',
      tax_source_id: '33333333-3333-4333-8333-333333333333',
      legal_text_draft_id: '99999999-9999-4999-8999-999999999999',
      draft_legal_text: draft,
    },
    catalog: emptyTaxKnowledgeProposalValidationCatalog(),
  });
  assert.equal(valid.valid_schema, true);
  assert.equal(valid.publication_eligible, false);
  assert.equal(canOwnerApproveTaxKnowledgeProposal(valid), true);

  const unknownField = validateTaxKnowledgeProposalV1({
    proposal_json: { ...closed, extra: true },
    context: {
      country_code: 'IL',
      tax_source_id: '33333333-3333-4333-8333-333333333333',
      legal_text_draft_id: '99999999-9999-4999-8999-999999999999',
      draft_legal_text: draft,
    },
    catalog: emptyTaxKnowledgeProposalValidationCatalog(),
  });
  assert.equal(unknownField.valid_schema, false);
  assert.ok(unknownField.errors.some((row) => row.code === 'unknown_field'));

  const omittedOptionalNested = validateTaxKnowledgeProposalV1({
    proposal_json: closed,
    context: {
      country_code: 'IL',
      tax_source_id: '33333333-3333-4333-8333-333333333333',
      legal_text_draft_id: '99999999-9999-4999-8999-999999999999',
      draft_legal_text: draft,
    },
    catalog: emptyTaxKnowledgeProposalValidationCatalog(),
  });
  assert.equal(omittedOptionalNested.valid_schema, true);
});
