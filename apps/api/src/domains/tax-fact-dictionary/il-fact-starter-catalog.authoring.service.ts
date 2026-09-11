import type { RequestContext } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';
import { executeCountryPackCommand } from '../country-pack/country-pack-commands.service.js';
import { executeTaxFactDictionaryCommand } from './tax-fact-dictionary-commands.service.js';
import { buildOwnerFactDictionaryAggregate } from './tax-fact-dictionary-read-models.service.js';
import type { OwnerTaxFactDefinitionDto } from './tax-fact-dictionary-read-models.pure.js';
import { IL_STARTER_FACT_SPECS, type IlStarterFactSpec } from './il-fact-starter-catalog.pure.js';

const COUNTRY = 'IL';
const LOCALE = 'he';
const EFFECTIVE_FROM = '2026-01-01';

function definitionFromSlice(
  definitions: OwnerTaxFactDefinitionDto[],
  factKey: string,
): OwnerTaxFactDefinitionDto | undefined {
  return definitions.find((row) => row.fact_key === factKey && row.country_code === COUNTRY);
}

async function loadIlDefinition(
  ctx: RequestContext,
  factKey: string,
): Promise<OwnerTaxFactDefinitionDto | undefined> {
  const slice = await buildOwnerFactDictionaryAggregate(ctx, { country_code: COUNTRY });
  return definitionFromSlice(slice.definitions, factKey);
}

async function ensureDefinition(
  ctx: RequestContext,
  spec: IlStarterFactSpec,
): Promise<OwnerTaxFactDefinitionDto> {
  let definition = await loadIlDefinition(ctx, spec.fact_key);
  if (!definition) {
    await executeTaxFactDictionaryCommand(ctx, 'create_tax_fact_definition', {
      fact_key: spec.fact_key,
      country_code: COUNTRY,
      semantic_title: spec.semantic_title,
      owner_note: spec.owner_note,
    });
    definition = await loadIlDefinition(ctx, spec.fact_key);
  }
  if (!definition) throw new Error(`Failed to create IL fact ${spec.fact_key}`);
  if (definition.status === 'draft') {
    await executeTaxFactDictionaryCommand(ctx, 'activate_tax_fact_definition', {
      tax_fact_definition_id: definition.id,
    });
    definition = (await loadIlDefinition(ctx, spec.fact_key)) ?? definition;
  }
  return definition;
}

async function ensureActiveVersion(
  ctx: RequestContext,
  spec: IlStarterFactSpec,
  definition: OwnerTaxFactDefinitionDto,
): Promise<OwnerTaxFactDefinitionDto> {
  let current = definition;
  let version =
    current.versions.find((row) => row.status === 'active') ??
    current.versions.find((row) => row.status === 'draft');
  if (!version) {
    await executeTaxFactDictionaryCommand(ctx, 'create_tax_fact_definition_version', {
      tax_fact_definition_id: current.id,
      value_type: spec.value_type,
      currency_policy: spec.currency_policy,
      validation_json: {},
      effective_from: EFFECTIVE_FROM,
    });
    current = (await loadIlDefinition(ctx, spec.fact_key)) ?? current;
    version = current.versions.find((row) => row.status === 'draft');
  }
  if (!version) throw new Error(`Failed to create IL fact version ${spec.fact_key}`);
  if (version.status === 'draft') {
    if (spec.value_type === 'enum') {
      const existingCodes = new Set(version.enum_options.map((row) => row.code));
      for (const option of spec.enum_options) {
        if (existingCodes.has(option.code)) continue;
        await executeTaxFactDictionaryCommand(ctx, 'add_tax_fact_enum_option', {
          tax_fact_definition_version_id: version.id,
          code: option.code,
          sort_order: option.sort_order,
        });
      }
    }
    await executeTaxFactDictionaryCommand(ctx, 'activate_tax_fact_definition_version', {
      tax_fact_definition_version_id: version.id,
    });
    current = (await loadIlDefinition(ctx, spec.fact_key)) ?? current;
  }
  return current;
}

async function ensureHebrewPresentation(
  ctx: RequestContext,
  spec: IlStarterFactSpec,
  definition: OwnerTaxFactDefinitionDto,
): Promise<void> {
  const hasHe = definition.presentations.some((row) => row.locale === LOCALE);
  if (hasHe) return;
  const enumOptionLabels = Object.fromEntries(spec.enum_options.map((row) => [row.code, row.he_label]));
  await executeTaxFactDictionaryCommand(ctx, 'create_tax_fact_presentation', {
    tax_fact_definition_id: definition.id,
    country_code: COUNTRY,
    locale: LOCALE,
    label: spec.he_label,
    professional_question: spec.he_professional_question,
    help_text: spec.he_help_text,
    aliases: [],
    enum_option_labels: enumOptionLabels,
  });
}

export async function publishIsraelStarterFactCatalog(ctx: RequestContext): Promise<OwnerTaxFactDefinitionDto[]> {
  try {
    await executeCountryPackCommand(ctx, {
      command: 'update_country_localization',
      payload: {
        country_code: COUNTRY,
        default_locale: LOCALE,
        supported_locales: [LOCALE],
      },
    });
  } catch (error) {
    if (!(error instanceof AppError && /schema is not applied/i.test(error.message))) {
      throw error;
    }
  }

  const published: OwnerTaxFactDefinitionDto[] = [];
  for (const spec of IL_STARTER_FACT_SPECS) {
    let definition = await ensureDefinition(ctx, spec);
    definition = await ensureActiveVersion(ctx, spec, definition);
    await ensureHebrewPresentation(ctx, spec, definition);
    const finalDefinition = await loadIlDefinition(ctx, spec.fact_key);
    if (!finalDefinition) throw new Error(`IL fact ${spec.fact_key} missing after authoring`);
    published.push(finalDefinition);
  }
  return published;
}
