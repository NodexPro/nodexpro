import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
  throwIfSupabaseError,
  type SupabaseErrorLike,
} from '../../shared/supabase-errors.js';
import {
  assertFileAllowedForSettingsImage,
  validateOrgFileOwnership,
} from '../file-access/file-access.service.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import { renderStudioSamplePreviewHtml } from './income-document-branding-preview.renderer.js';
import {
  DEFAULT_DISPLAY_OPTIONS,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  DEFAULT_COLOR_THEME_KEY,
  DEFAULT_DOCUMENT_STYLE_KEY,
  DEFAULT_LOGO_SIZE_KEY,
  normalizeClientBlockPosition,
  optionalTrimmedString,
  parseDisplayOptionsJson,
  parsePaymentMethodsJson,
  normalizeStudioDocumentStyleKey,
  applyColorThemeToColorColumns,
  applyDocumentStyleTemplateKey,
  getColorThemePresets,
  getDocumentStyleTemplates,
  getLogoSizeOptions,
  resolveBrandingProfile,
  resolveColorThemeKeyForRow,
  resolveColorThemePreset,
  resolveDocumentStyleKeyForRow,
  resolveDocumentStyleTemplate,
  resolveLogoSizeKey,
  serializeDisplayOptionsJson,
  serializePaymentMethodsJson,
  getEmailTemplateTokens,
  buildEmailTemplateEditor,
  buildEmailTemplatePreview,
  buildDisplayOptionControls,
  buildStudioSampleIssuerIdentityPreview,
  buildStudioSampleLivePreview,
  buildPaymentSettingsPanel,
  getDocumentTypeStyleDefaults,
  getStudioColorThemePresets,
  getStudioNavigationSections,
  mergeDisplayOptionsFromStudioBody,
  mergePaymentMethodsFromStudioBody,
  encodeEmailTemplateFromFriendly,
  buildDocumentTypeStyleGroups,
  parseDocumentTypeStyleOverridesJson,
  serializeDocumentTypeStyleOverridesJson,
  applyDocumentTypeStyleOverridesFromBody,
  resolveBrandingProfileForDocumentTypeGroup,
  resolveDocumentTypeStyleGroupKey,
  normalizeDocumentTypeStyleGroupKey,
  INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS,
} from './income-document-branding.pure.js';
import type {
  IncomeBrandingDisplayOptions,
  IncomeBrandingPaymentMethod,
  IncomeBrandingProfileRow,
  IncomeBrandingResolvedProfile,
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingSettingsEntrypoint,
  IncomeDocumentBrandingStudio,
  IncomeDocumentBrandingStudioPreviewDraftResult,
  IncomeDocumentStyleTemplateKey,
  IncomeDocumentTypeStyleGroupKey,
} from './income-document-branding.types.js';
import type { IncomeWorkspacePermissions } from './income.types.js';
import {
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
  INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
  INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
} from './income-document-branding.types.js';

const BUCKET_ORG_ASSETS = 'organization-assets';
const BRANDING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BRANDING_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const BRANDING_MIGRATION_HINT =
  'Run Supabase migrations 130–133 for income_document_branding_profiles on production.';

const STUDIO_OPTIONAL_COLUMNS = [
  'color_theme_key',
  'layout_template_key',
  'logo_size_key',
  'document_type_style_overrides',
] as const;

function omitPatchKey(patch: Record<string, unknown>, key: string): Record<string, unknown> {
  const next = { ...patch };
  delete next[key];
  return next;
}

async function persistBrandingProfilePatch(
  rowId: string,
  orgId: string,
  patch: Record<string, unknown>,
  context: string,
): Promise<IncomeBrandingProfileRow> {
  const runUpdate = async (payload: Record<string, unknown>) => {
    return supabaseAdmin
      .from('income_document_branding_profiles')
      .update(payload)
      .eq('id', rowId)
      .eq('organization_id', orgId)
      .select('*')
      .single();
  };

  let { data, error } = await runUpdate(patch);
  if (error) {
    let nextPatch = { ...patch };
    for (const col of STUDIO_OPTIONAL_COLUMNS) {
      if (col in nextPatch && isSupabaseMissingColumnError(error as SupabaseErrorLike, col)) {
        console.warn(`[income-branding] ${col} column missing — persisting without until migration 132 is applied`);
        nextPatch = omitPatchKey(nextPatch, col);
        ({ data, error } = await runUpdate(nextPatch));
        if (!error) break;
      }
    }
  }
  if (
    error &&
    'document_style_key' in patch &&
    isSupabaseMissingColumnError(error as SupabaseErrorLike, 'document_style_key')
  ) {
    console.warn(
      '[income-branding] document_style_key column missing — persisting colors only until migration 131 is applied',
    );
    ({ data, error } = await runUpdate(omitPatchKey(patch, 'document_style_key')));
  }

  throwIfSupabaseError(error as SupabaseErrorLike | null, context, {
    migrationHint: BRANDING_MIGRATION_HINT,
  });
  return data as IncomeBrandingProfileRow;
}

let bucketEnsured = false;
async function ensureOrgAssetsBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET_ORG_ASSETS, { public: false });
  if (error && !error.message?.includes('already exists')) {
    console.error('[income-branding] bucket ensure failed:', error.message);
  }
  bucketEnsured = true;
}

async function fileAssetToDataUrl(fileAssetId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('file_assets')
    .select('storage_bucket, storage_key, mime_type, archived_at')
    .eq('id', fileAssetId)
    .maybeSingle();
  throwIfSupabaseError(error, 'fileAssetToDataUrl');
  const row = data as
    | { storage_bucket?: string | null; storage_key?: string; mime_type?: string | null; archived_at?: string | null }
    | null;
  if (!row?.storage_key || row.archived_at) return null;
  const bucket = row.storage_bucket ?? BUCKET_ORG_ASSETS;
  if (bucket === BUCKET_ORG_ASSETS) await ensureOrgAssetsBucket();
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(row.storage_key);
  if (dlErr || !blob) return null;
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = (row.mime_type ?? 'image/png').split(';')[0].trim();
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function loadBrandingRow(scope: ActiveIncomeIssuerScope): Promise<IncomeBrandingProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_branding_profiles')
    .select('*')
    .eq('organization_id', scope.org_id)
    .eq('issuer_business_id', scope.issuer_business_id)
    .maybeSingle();
  throwIfSupabaseError(error as SupabaseErrorLike | null, 'loadBrandingRow', {
    migrationHint: BRANDING_MIGRATION_HINT,
  });
  return (data as IncomeBrandingProfileRow | null) ?? null;
}

async function bootstrapFromOrganizationSettings(
  scope: ActiveIncomeIssuerScope,
): Promise<IncomeBrandingProfileRow> {
  const { data: settings, error } = await supabaseAdmin
    .from('organization_settings')
    .select(
      'logo_file_asset_id, signature_image_file_asset_id, display_name_on_documents, document_footer_note, display_phone_on_documents, display_website_on_documents, display_address_on_documents, display_bank_details_on_documents, bank_name, bank_branch, bank_account_number, iban, swift',
    )
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  throwIfSupabaseError(error as SupabaseErrorLike | null, 'bootstrapBrandingFromOrgSettings', {
    migrationHint: BRANDING_MIGRATION_HINT,
  });

  const s = settings as Record<string, unknown> | null;
  const display: IncomeBrandingDisplayOptions = {
    ...DEFAULT_DISPLAY_OPTIONS,
    show_business_phone: s?.display_phone_on_documents !== false,
    show_business_address: s?.display_address_on_documents !== false,
    show_bank_details: s?.display_bank_details_on_documents === true,
  };

  const insert = {
    organization_id: scope.org_id,
    issuer_business_id: scope.issuer_business_id,
    represented_client_id: scope.represented_client_id,
    logo_file_asset_id: (s?.logo_file_asset_id as string | null) ?? null,
    signature_file_asset_id: (s?.signature_image_file_asset_id as string | null) ?? null,
    company_subtitle: typeof s?.display_name_on_documents === 'string' ? s.display_name_on_documents : null,
    document_style_key: DEFAULT_DOCUMENT_STYLE_KEY,
    color_theme_key: DEFAULT_COLOR_THEME_KEY,
    logo_size_key: DEFAULT_LOGO_SIZE_KEY,
    primary_color: DEFAULT_PRIMARY_COLOR,
    secondary_color: DEFAULT_SECONDARY_COLOR,
    table_header_color: DEFAULT_PRIMARY_COLOR,
    totals_color: DEFAULT_PRIMARY_COLOR,
    client_block_position: 'right',
    footer_text: typeof s?.document_footer_note === 'string' ? s.document_footer_note : null,
    bank_name: typeof s?.bank_name === 'string' ? s.bank_name : null,
    bank_branch: typeof s?.bank_branch === 'string' ? s.bank_branch : null,
    bank_account: typeof s?.bank_account_number === 'string' ? s.bank_account_number : null,
    iban: typeof s?.iban === 'string' ? s.iban : null,
    swift: typeof s?.swift === 'string' ? s.swift : null,
    email_subject_template: '{{document_type}} מספר {{document_number}}',
    email_body_template:
      'שלום,\n\nמצורפת {{document_type}} מספר {{document_number}}.\n\nתודה רבה.',
    display_options: serializeDisplayOptionsJson(display),
    payment_methods: serializePaymentMethodsJson(DEFAULT_PAYMENT_METHODS),
    document_attachments: [],
    default_payment_terms: null,
    document_type_style_overrides: {},
  };

  let { data, error: insErr } = await supabaseAdmin
    .from('income_document_branding_profiles')
    .insert(insert)
    .select('*')
    .single();

  if (
    insErr &&
    isSupabaseMissingColumnError(insErr as SupabaseErrorLike, 'document_style_key')
  ) {
    console.warn(
      '[income-branding] document_style_key column missing on insert — bootstrap without style key until migration 131',
    );
    ({ data, error: insErr } = await supabaseAdmin
      .from('income_document_branding_profiles')
      .insert(omitPatchKey(insert, 'document_style_key'))
      .select('*')
      .single());
  }

  if (insErr && isSupabaseMissingTableError(insErr as SupabaseErrorLike, 'income_document_branding_profiles')) {
    throwIfSupabaseError(insErr as SupabaseErrorLike, 'insertBrandingProfile', {
      migrationHint: BRANDING_MIGRATION_HINT,
    });
  }

  throwIfSupabaseError(insErr as SupabaseErrorLike | null, 'insertBrandingProfile', {
    migrationHint: BRANDING_MIGRATION_HINT,
  });
  return data as IncomeBrandingProfileRow;
}

export async function ensureIncomeDocumentBrandingProfile(
  scope: ActiveIncomeIssuerScope,
): Promise<IncomeBrandingProfileRow> {
  const existing = await loadBrandingRow(scope);
  if (existing) return existing;
  return bootstrapFromOrganizationSettings(scope);
}

export async function loadResolvedBrandingProfile(
  scope: ActiveIncomeIssuerScope,
  options?: { includeAssetDataUrls?: boolean },
): Promise<IncomeBrandingResolvedProfile> {
  const row = await ensureIncomeDocumentBrandingProfile(scope);
  const includeAssetDataUrls = options?.includeAssetDataUrls !== false;
  const logo_data_url =
    includeAssetDataUrls && row.logo_file_asset_id
      ? await fileAssetToDataUrl(row.logo_file_asset_id)
      : null;
  const signature_data_url =
    includeAssetDataUrls && row.signature_file_asset_id
      ? await fileAssetToDataUrl(row.signature_file_asset_id)
      : null;
  return resolveBrandingProfile(row, { logo_data_url, signature_data_url });
}

export async function loadResolvedBrandingProfileForDocumentType(
  scope: ActiveIncomeIssuerScope,
  documentType: string,
): Promise<IncomeBrandingResolvedProfile> {
  const row = await ensureIncomeDocumentBrandingProfile(scope);
  const logo_data_url = row.logo_file_asset_id
    ? await fileAssetToDataUrl(row.logo_file_asset_id)
    : null;
  const signature_data_url = row.signature_file_asset_id
    ? await fileAssetToDataUrl(row.signature_file_asset_id)
    : null;
  const groupKey = resolveDocumentTypeStyleGroupKey(documentType);
  return resolveBrandingProfileForDocumentTypeGroup(
    row,
    { logo_data_url, signature_data_url },
    groupKey,
  );
}

function buildEmailTemplateStudioParts(resolved: IncomeBrandingResolvedProfile) {
  const tokens = getEmailTemplateTokens();
  return {
    email_template_tokens: tokens,
    email_template_editor: buildEmailTemplateEditor(
      resolved.email_subject_template,
      resolved.email_body_template,
      tokens,
    ),
    email_template_preview: buildEmailTemplatePreview(
      resolved.email_subject_template,
      resolved.email_body_template,
      tokens,
    ),
  };
}

async function buildDocumentBrandingStudio(
  scope: ActiveIncomeIssuerScope,
  resolved: IncomeBrandingResolvedProfile,
  row: IncomeBrandingProfileRow,
  options?: { includeStudioPreviewHtml?: boolean },
): Promise<IncomeDocumentBrandingStudio> {
  const display = resolved.display_options;
  const overrides = parseDocumentTypeStyleOverridesJson(row.document_type_style_overrides);
  const selectedGroupKey: IncomeDocumentTypeStyleGroupKey = 'quote_deal';
  const groups = buildDocumentTypeStyleGroups(overrides);
  const groupDef =
    INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS.find((entry) => entry.group_key === selectedGroupKey) ??
    INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS[0]!;
  const logo_data_url = resolved.logo_data_url;
  const signature_data_url = resolved.signature_data_url;
  const resolvedForGroup = resolveBrandingProfileForDocumentTypeGroup(
    row,
    { logo_data_url, signature_data_url },
    selectedGroupKey,
    overrides,
  );
  const emailParts = buildEmailTemplateStudioParts(resolved);

  return {
    navigation_sections: getStudioNavigationSections(),
    document_style_templates: getDocumentStyleTemplates(resolvedForGroup.color_theme_key),
    color_theme_presets: getColorThemePresets(),
    studio_color_theme_presets: getStudioColorThemePresets(),
    display_option_controls: buildDisplayOptionControls(display),
    issuer_identity_preview: buildStudioSampleIssuerIdentityPreview(),
    payment_settings_panel: buildPaymentSettingsPanel({
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      payment_methods: resolved.payment_methods,
    }),
    document_type_style_defaults: getDocumentTypeStyleDefaults(),
    document_type_style_groups: groups,
    selected_document_type_group_key: selectedGroupKey,
    document_type_style_overrides: overrides,
    layout_templates: [],
    logo_size_options: getLogoSizeOptions(),
    selected_document_style_key: resolvedForGroup.document_style_key,
    selected_color_theme_key: resolvedForGroup.color_theme_key,
    selected_layout_template_key: null,
    selected_logo_size_key: resolved.logo_size_key,
    advanced_layout_visible: false,
    studio_live_preview: buildStudioSampleLivePreview({
      preview_html:
        options?.includeStudioPreviewHtml === false
          ? ''
          : renderStudioSamplePreviewHtml(resolvedForGroup, groupDef.sample_document_type_label),
      sample_document_type_label: groupDef.sample_document_type_label,
    }),
    ...emailParts,
    fields: {
      show_logo: display.show_logo,
      company_subtitle: resolved.company_subtitle,
      show_signature: display.show_signature,
      footer_text: resolved.footer_text,
      bank_name: resolved.bank_name,
      bank_branch: resolved.bank_branch,
      bank_account: resolved.bank_account,
      iban: resolved.iban,
      swift: resolved.swift,
      payment_instructions: resolved.payment_instructions,
      email_subject_template: resolved.email_subject_template,
      email_body_template: resolved.email_body_template,
      customer_notes: resolved.customer_notes,
      terms_and_conditions: resolved.terms_and_conditions,
    },
    save_section_key: 'modal',
    save_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
    preview_draft_command: INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
  };
}

export function buildDocumentBrandingSettingsEntrypoint(
  permissions: IncomeWorkspacePermissions,
): IncomeDocumentBrandingSettingsEntrypoint {
  const canEdit = permissions.edit;
  return {
    visible: permissions.view,
    button_label: '⚙ הגדרות מסמך',
    modal_title: 'הגדרות מסמך',
    allowed_actions: canEdit
      ? [
          INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
          INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
          INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
          INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
        ]
      : [],
    commands: {
      update_branding_profile: INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
      preview_branding_profile_draft: INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
      upload_document_logo: INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
      upload_document_signature: INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
    },
  };
}

export async function buildDocumentBrandingProfileAggregate(
  scope: ActiveIncomeIssuerScope,
  canEdit: boolean,
  options?: { lean?: boolean },
): Promise<IncomeDocumentBrandingProfileAggregate> {
  const row = await ensureIncomeDocumentBrandingProfile(scope);
  const lean = options?.lean === true;
  const resolved = await loadResolvedBrandingProfile(scope, { includeAssetDataUrls: !lean });
  const uploadLogoActions = canEdit ? [INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO] : [];
  const uploadSigActions = canEdit ? [INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE] : [];

  return {
    profile_id: row.id,
    title: 'הגדרות מסמך',
    document_branding_studio: await buildDocumentBrandingStudio(scope, resolved, row, {
      includeStudioPreviewHtml: !lean,
    }),
    logo: {
      label: 'לוגו מסמך',
      file_asset_id: row.logo_file_asset_id,
      preview_data_url: resolved.logo_data_url,
      upload_command: INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
      allowed_actions: uploadLogoActions,
      hint: 'PNG, JPEG או WebP — עד 5MB',
      recommended_size_hint: 'מומלץ להעלות לוגו בגודל מינימלי 300×200 פיקסלים',
      can_remove: canEdit && Boolean(row.logo_file_asset_id),
    },
    signature: {
      label: 'חתימה',
      file_asset_id: row.signature_file_asset_id,
      preview_data_url: resolved.signature_data_url,
      upload_command: INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
      allowed_actions: uploadSigActions,
      hint: 'PNG, JPEG או WebP — עד 5MB',
      recommended_size_hint: null,
      can_remove: canEdit && Boolean(row.signature_file_asset_id),
    },
    allowed_actions: canEdit
      ? [
          INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
          INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
          INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
          INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
        ]
      : [],
  };
}

function mergeBrandingDraftBodyOntoRow(
  row: IncomeBrandingProfileRow,
  body: Record<string, unknown>,
): IncomeBrandingProfileRow {
  const patch: Record<string, unknown> = {};
  applyModalBrandingPatch(row, body, patch);
  const overrides = applyDocumentTypeStyleOverridesFromBody(row, body);
  patch.document_type_style_overrides = serializeDocumentTypeStyleOverridesJson(overrides);
  return { ...row, ...patch } as IncomeBrandingProfileRow;
}

async function resolveBrandingProfileForRowWithGroup(
  row: IncomeBrandingProfileRow,
  groupKey: IncomeDocumentTypeStyleGroupKey,
): Promise<IncomeBrandingResolvedProfile> {
  const logo_data_url = row.logo_file_asset_id
    ? await fileAssetToDataUrl(row.logo_file_asset_id)
    : null;
  const signature_data_url = row.signature_file_asset_id
    ? await fileAssetToDataUrl(row.signature_file_asset_id)
    : null;
  const overrides = parseDocumentTypeStyleOverridesJson(row.document_type_style_overrides);
  return resolveBrandingProfileForDocumentTypeGroup(
    row,
    { logo_data_url, signature_data_url },
    groupKey,
    overrides,
  );
}

export async function previewIncomeDocumentBrandingProfileDraft(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<IncomeDocumentBrandingStudioPreviewDraftResult> {
  const row = await ensureIncomeDocumentBrandingProfile(scope);
  const draftRow = mergeBrandingDraftBodyOntoRow(row, body);
  const groupKey =
    normalizeDocumentTypeStyleGroupKey(body.selected_document_type_group_key) ?? 'quote_deal';
  const resolved = await resolveBrandingProfileForRowWithGroup(draftRow, groupKey);
  const overrides = parseDocumentTypeStyleOverridesJson(draftRow.document_type_style_overrides);
  const groupDef =
    INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS.find((entry) => entry.group_key === groupKey) ??
    INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS[0]!;
  const emailParts = buildEmailTemplateStudioParts(resolved);

  return {
    studio_live_preview: buildStudioSampleLivePreview({
      preview_html: renderStudioSamplePreviewHtml(resolved, groupDef.sample_document_type_label),
      sample_document_type_label: groupDef.sample_document_type_label,
    }),
    selected_document_type_group_key: groupKey,
    document_type_style_groups: buildDocumentTypeStyleGroups(overrides),
    selected_document_style_key: resolved.document_style_key,
    selected_color_theme_key: resolved.color_theme_key,
    selected_layout_template_key: null,
    selected_logo_size_key: resolved.logo_size_key,
    document_style_templates: getDocumentStyleTemplates(resolved.color_theme_key),
    email_template_preview: emailParts.email_template_preview,
  };
}

function applyEmailTemplatePatch(
  body: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  const tokens = getEmailTemplateTokens();
  if (body.email_subject_friendly !== undefined || body.email_body_friendly !== undefined) {
    if (body.email_subject_friendly !== undefined) {
      patch.email_subject_template = encodeEmailTemplateFromFriendly(
        String(body.email_subject_friendly),
        tokens,
      );
    }
    if (body.email_body_friendly !== undefined) {
      patch.email_body_template = encodeEmailTemplateFromFriendly(
        String(body.email_body_friendly),
        tokens,
      );
    }
    return;
  }
  if (body.email_subject_template !== undefined) {
    patch.email_subject_template = optionalTrimmedString(body.email_subject_template, 500);
  }
  if (body.email_body_template !== undefined) {
    patch.email_body_template = optionalTrimmedString(body.email_body_template, 8000);
  }
}

function applyModalBrandingPatch(
  row: IncomeBrandingProfileRow,
  body: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  if (body.clear_logo === true) {
    patch.logo_file_asset_id = null;
  }
  if (body.clear_signature === true) {
    patch.signature_file_asset_id = null;
  }

  const overrides = applyDocumentTypeStyleOverridesFromBody(row, body);
  if (
    body.document_type_style_overrides !== undefined ||
    body.document_style_key !== undefined ||
    body.color_theme_key !== undefined ||
    body.color_preset_key !== undefined ||
    body.selected_document_type_group_key !== undefined
  ) {
    patch.document_type_style_overrides = serializeDocumentTypeStyleOverridesJson(overrides);
  }

  if (body.logo_size_key !== undefined) {
    patch.logo_size_key = resolveLogoSizeKey(body.logo_size_key);
  }

  patch.company_subtitle = optionalTrimmedString(body.company_subtitle, 500);
  patch.footer_text = optionalTrimmedString(body.footer_text, 2000);
  patch.bank_name = optionalTrimmedString(body.bank_name, 200);
  patch.bank_branch = optionalTrimmedString(body.bank_branch, 100);
  patch.bank_account = optionalTrimmedString(body.bank_account, 100);
  patch.swift = optionalTrimmedString(body.swift, 50);
  patch.iban = optionalTrimmedString(body.iban, 50);
  patch.payment_instructions = optionalTrimmedString(body.payment_instructions, 4000);
  applyEmailTemplatePatch(body, patch);
  patch.customer_notes = optionalTrimmedString(body.customer_notes, 4000);
  patch.terms_and_conditions = optionalTrimmedString(body.terms_and_conditions, 8000);

  const clientPos = normalizeClientBlockPosition(
    body.client_block_position ?? row.client_block_position,
  );
  const current = parseDisplayOptionsJson(row.display_options, clientPos);
  patch.display_options = serializeDisplayOptionsJson(
    mergeDisplayOptionsFromStudioBody(body, current, clientPos),
  );
  patch.client_block_position = clientPos;

  if (
    DEFAULT_PAYMENT_METHODS.some((method) => body[`payment_method_${method.key}`] !== undefined)
  ) {
    patch.payment_methods = serializePaymentMethodsJson(
      mergePaymentMethodsFromStudioBody(body, parsePaymentMethodsJson(row.payment_methods)),
    );
  }
}

function parseBooleanBody(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function updateIncomeDocumentBrandingProfile(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<IncomeBrandingProfileRow> {
  const section = String(body.section ?? '').trim();
  if (!section) throw badRequest('section is required', 'BRANDING_SECTION_REQUIRED');

  const row = await ensureIncomeDocumentBrandingProfile(scope);
  const patch: Record<string, unknown> = {};

  if (section === 'modal') {
    applyModalBrandingPatch(row, body, patch);
  } else if (section === 'document_design' || section === 'identity') {
    const colorKey = String(body.color_theme_key ?? body.document_style_key ?? '').trim();
    if (colorKey) {
      const theme = resolveColorThemePreset(colorKey);
      if (!theme) {
        throw badRequest('color_theme_key is invalid', 'BRANDING_COLOR_THEME_INVALID');
      }
      Object.assign(patch, applyColorThemeToColorColumns(theme));
    }
    const docStyleKey = String(body.document_style_key ?? '').trim();
    if (docStyleKey && resolveDocumentStyleTemplate(docStyleKey)) {
      Object.assign(patch, applyDocumentStyleTemplateKey(docStyleKey as IncomeDocumentStyleTemplateKey));
    }
    patch.company_subtitle = optionalTrimmedString(body.company_subtitle, 500);
    const clientPos = normalizeClientBlockPosition(
      body.client_block_position ?? row.client_block_position,
    );
    const current = parseDisplayOptionsJson(row.display_options, clientPos);
    const next: IncomeBrandingDisplayOptions = {
      ...current,
      show_logo: body.show_logo === undefined ? current.show_logo : parseBooleanBody(body.show_logo),
      client_block_position: clientPos,
    };
    patch.display_options = serializeDisplayOptionsJson(next);
    patch.client_block_position = clientPos;
  } else if (section === 'signature') {
    const clientPos = normalizeClientBlockPosition(row.client_block_position);
    const current = parseDisplayOptionsJson(row.display_options, clientPos);
    const next: IncomeBrandingDisplayOptions = {
      ...current,
      show_signature:
        body.show_signature === undefined ? current.show_signature : parseBooleanBody(body.show_signature),
    };
    patch.display_options = serializeDisplayOptionsJson(next);
  } else if (section === 'payment_details' || section === 'footer_bank') {
    patch.bank_name = optionalTrimmedString(body.bank_name, 200);
    patch.bank_branch = optionalTrimmedString(body.bank_branch, 100);
    patch.bank_account = optionalTrimmedString(body.bank_account, 100);
    patch.swift = optionalTrimmedString(body.swift, 50);
    patch.iban = optionalTrimmedString(body.iban, 50);
    if (section === 'footer_bank') {
      patch.footer_text = optionalTrimmedString(body.footer_text, 2000);
    }
  } else if (section === 'notes_terms' || section === 'customer_notes_terms') {
    patch.footer_text = optionalTrimmedString(body.footer_text, 2000);
    patch.customer_notes = optionalTrimmedString(body.customer_notes, 4000);
    patch.terms_and_conditions = optionalTrimmedString(body.terms_and_conditions, 8000);
  } else if (section === 'display_options') {
    const clientPos = normalizeClientBlockPosition(body.client_block_position);
    const current = parseDisplayOptionsJson(row.display_options, clientPos);
    const next: IncomeBrandingDisplayOptions = {
      ...current,
      show_logo: body.show_logo === undefined ? current.show_logo : parseBooleanBody(body.show_logo),
      show_business_address:
        body.show_business_address === undefined
          ? current.show_business_address
          : parseBooleanBody(body.show_business_address),
      show_business_phone:
        body.show_business_phone === undefined
          ? current.show_business_phone
          : parseBooleanBody(body.show_business_phone),
      show_business_email:
        body.show_business_email === undefined
          ? current.show_business_email
          : parseBooleanBody(body.show_business_email),
      show_business_tax_id:
        body.show_business_tax_id === undefined
          ? current.show_business_tax_id
          : parseBooleanBody(body.show_business_tax_id),
      show_due_date:
        body.show_due_date === undefined ? current.show_due_date : parseBooleanBody(body.show_due_date),
      show_payment_terms:
        body.show_payment_terms === undefined
          ? current.show_payment_terms
          : parseBooleanBody(body.show_payment_terms),
      show_signature:
        body.show_signature === undefined ? current.show_signature : parseBooleanBody(body.show_signature),
      show_footer:
        body.show_footer === undefined ? current.show_footer : parseBooleanBody(body.show_footer),
      show_bank_details:
        body.show_bank_details === undefined
          ? current.show_bank_details
          : parseBooleanBody(body.show_bank_details),
      show_notes:
        body.show_notes === undefined ? current.show_notes : parseBooleanBody(body.show_notes),
      show_item_index:
        body.show_item_index === undefined ? current.show_item_index : parseBooleanBody(body.show_item_index),
      show_discount_row:
        body.show_discount_row === undefined
          ? current.show_discount_row
          : parseBooleanBody(body.show_discount_row),
      show_vat_row:
        body.show_vat_row === undefined ? current.show_vat_row : parseBooleanBody(body.show_vat_row),
      show_currency:
        body.show_currency === undefined ? current.show_currency : parseBooleanBody(body.show_currency),
      quantity_position:
        body.quantity_position === 'after_description' ? 'after_description' : current.quantity_position,
      client_block_position: clientPos,
    };
    patch.display_options = serializeDisplayOptionsJson(next);
    patch.client_block_position = clientPos;
  } else if (section === 'email_templates') {
    applyEmailTemplatePatch(body, patch);
  } else if (section === 'payment_methods') {
    const methods = parsePaymentMethodsJson(row.payment_methods);
    const next: IncomeBrandingPaymentMethod[] = methods.map((m) => ({
      ...m,
      enabled:
        body[`payment_method_${m.key}`] === undefined
          ? m.enabled
          : parseBooleanBody(body[`payment_method_${m.key}`]),
    }));
    patch.payment_methods = serializePaymentMethodsJson(next);
  } else {
    throw badRequest(`Unknown branding section: ${section}`, 'BRANDING_SECTION_INVALID');
  }

  const data = await persistBrandingProfilePatch(
    row.id,
    scope.org_id,
    patch,
    'updateIncomeDocumentBrandingProfile',
  );

  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_branding_profile',
    entityId: row.id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_BRANDING_UPDATED,
    payload: { section, issuer_business_id: scope.issuer_business_id },
  }).catch(() => {});

  return data;
}

async function uploadBrandingImage(
  ctx: RequestContext,
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
  slot: 'logo' | 'signature',
): Promise<IncomeBrandingProfileRow> {
  const fileName = String(body.file_name ?? '').trim();
  const fileBase64 = String(body.file_base64 ?? '').trim();
  if (!fileName) throw badRequest('file_name is required');
  if (!fileBase64) throw badRequest('file_base64 is required');

  const mimeType = String(body.mime_type ?? 'image/png')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (!BRANDING_IMAGE_MIME.has(mimeType)) {
    throw badRequest('Invalid image type. Allowed: PNG, JPEG, WebP', 'BRANDING_IMAGE_TYPE_INVALID');
  }

  const buf = Buffer.from(fileBase64, 'base64');
  if (buf.length === 0) throw badRequest('File is empty');
  if (buf.length > BRANDING_IMAGE_MAX_BYTES) {
    throw badRequest('File too large. Maximum 5MB', 'BRANDING_IMAGE_TOO_LARGE');
  }

  await ensureOrgAssetsBucket();
  const storageKey = `${scope.org_id}/income-branding/${scope.issuer_business_id}/${slot}-${Date.now()}`;
  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_ORG_ASSETS).upload(storageKey, buf, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) throw badRequest(uploadError.message ?? 'Upload failed', 'BRANDING_UPLOAD_FAILED');

  const { data: fileAsset, error: fileErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: scope.org_id,
      storage_provider: 'supabase',
      storage_bucket: BUCKET_ORG_ASSETS,
      storage_key: storageKey,
      file_name: fileName,
      mime_type: mimeType,
      file_size: buf.length,
      uploaded_by: scope.actor_user_id,
      access_level: 'organization',
    })
    .select('id')
    .single();
  throwIfSupabaseError(fileErr, 'insertBrandingFileAsset');

  const fileId = String((fileAsset as { id: string }).id);
  const fileRow = await validateOrgFileOwnership(ctx, scope.org_id, fileId);
  assertFileAllowedForSettingsImage(fileRow);

  const row = await ensureIncomeDocumentBrandingProfile(scope);
  const patch =
    slot === 'logo'
      ? { logo_file_asset_id: fileId }
      : { signature_file_asset_id: fileId };

  const data = await persistBrandingProfilePatch(row.id, scope.org_id, patch, 'linkBrandingImage');

  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_branding_profile',
    entityId: row.id,
    action:
      slot === 'logo'
        ? AUDIT_ACTIONS.INCOME_DOCUMENT_BRANDING_LOGO_UPLOADED
        : AUDIT_ACTIONS.INCOME_DOCUMENT_BRANDING_SIGNATURE_UPLOADED,
    payload: { file_asset_id: fileId, issuer_business_id: scope.issuer_business_id },
  }).catch(() => {});

  return data;
}

export async function uploadIncomeDocumentLogo(
  ctx: RequestContext,
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<IncomeBrandingProfileRow> {
  return uploadBrandingImage(ctx, scope, body, 'logo');
}

export async function uploadIncomeDocumentSignature(
  ctx: RequestContext,
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<IncomeBrandingProfileRow> {
  return uploadBrandingImage(ctx, scope, body, 'signature');
}
