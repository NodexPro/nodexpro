/**
 * INV-13A Phase 1 — Owner Invoice Document Builder commands + aggregate.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { getOwnerInvoiceFieldCatalog } from './owner-invoice-document-field-catalog.pure.js';
import {
  buildOwnerInvoiceLayoutIssueFreezeFromPublished,
  type OwnerInvoiceLayoutIssueFreeze,
} from './owner-invoice-document-layout-issue-freeze.pure.js';
import {
  assertOwnerInvoiceLayoutVersionMutable,
  moveOwnerInvoiceLayoutField,
  moveOwnerInvoiceLayoutSection,
  planPublishOwnerInvoiceLayoutVersion,
  resizeOwnerInvoiceLayoutSection,
  setOwnerInvoiceFieldVisibility,
  setOwnerInvoiceTableColumn,
} from './owner-invoice-document-layout-mutations.pure.js';
import { buildOwnerInvoiceLayoutPreviewHtml } from './owner-invoice-document-layout-preview.service.js';
import { parseAndValidateOwnerInvoiceLayoutDefinition } from './owner-invoice-document-layout-schema.pure.js';
import { buildSectionedGoldenMasterLayoutDefinitionV1 } from './owner-invoice-document-layout-seed.pure.js';
import {
  OWNER_INVOICE_LAYOUT_AGGREGATE_KEY,
  OWNER_INVOICE_LAYOUT_COMMANDS,
  OWNER_INVOICE_LAYOUT_DOCUMENT_TYPE_GROUPS,
  OWNER_INVOICE_LAYOUT_KEY_DEFAULT,
  isOwnerInvoiceLayoutCommand,
  type OwnerInvoiceLayoutCommand,
  type OwnerInvoiceLayoutDefinitionV1,
  type OwnerInvoiceLayoutDocumentTypeGroup,
  type OwnerInvoiceLayoutStatus,
  type OwnerInvoiceLayoutVersionRow,
} from './owner-invoice-document-layout.types.js';

export { isOwnerInvoiceLayoutCommand };

type LayoutCommandResponse = {
  ok: true;
  command: OwnerInvoiceLayoutCommand;
  refreshed: {
    aggregate_key: typeof OWNER_INVOICE_LAYOUT_AGGREGATE_KEY;
    aggregate: Record<string, unknown>;
  };
};

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  return value.trim();
}

function asOptionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw badRequest('Invalid string value');
  const v = value.trim();
  return v.length ? v : null;
}

function asDocumentTypeGroup(value: unknown): OwnerInvoiceLayoutDocumentTypeGroup {
  const v = typeof value === 'string' && value.trim() ? value.trim() : 'all';
  if (!(OWNER_INVOICE_LAYOUT_DOCUMENT_TYPE_GROUPS as readonly string[]).includes(v)) {
    throw badRequest('document_type_group invalid');
  }
  return v as OwnerInvoiceLayoutDocumentTypeGroup;
}

function mapRow(raw: Record<string, unknown>): OwnerInvoiceLayoutVersionRow {
  return {
    id: String(raw.id),
    layout_key: String(raw.layout_key),
    version_number: Number(raw.version_number),
    document_type_group: raw.document_type_group as OwnerInvoiceLayoutDocumentTypeGroup,
    country_code: (raw.country_code as string | null) ?? null,
    status: raw.status as OwnerInvoiceLayoutStatus,
    layout_definition_json: parseAndValidateOwnerInvoiceLayoutDefinition(raw.layout_definition_json),
    based_on_version_id: (raw.based_on_version_id as string | null) ?? null,
    published_at: (raw.published_at as string | null) ?? null,
    archived_at: (raw.archived_at as string | null) ?? null,
    created_by: (raw.created_by as string | null) ?? null,
    updated_by: (raw.updated_by as string | null) ?? null,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

async function auditLayout(
  ctx: RequestContext,
  action: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: 'owner_invoice_document_layout_version',
    entityId,
    action,
    payload,
  });
}

async function listVersions(params: {
  layout_key: string;
  document_type_group: OwnerInvoiceLayoutDocumentTypeGroup;
  country_code: string | null;
}): Promise<OwnerInvoiceLayoutVersionRow[]> {
  let q = supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .select('*')
    .eq('layout_key', params.layout_key)
    .eq('document_type_group', params.document_type_group)
    .order('version_number', { ascending: false });
  if (params.country_code == null) {
    q = q.is('country_code', null);
  } else {
    q = q.eq('country_code', params.country_code);
  }
  const { data, error } = await q;
  throwIfSupabaseError(error, 'listOwnerInvoiceLayoutVersions');
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

async function loadVersionById(id: string): Promise<OwnerInvoiceLayoutVersionRow> {
  const { data, error } = await supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadOwnerInvoiceLayoutVersion');
  if (!data) throw notFound('Owner invoice layout version not found');
  return mapRow(data as Record<string, unknown>);
}

function pickWorkingVersion(versions: OwnerInvoiceLayoutVersionRow[]): OwnerInvoiceLayoutVersionRow | null {
  return (
    versions.find((v) => v.status === 'draft') ??
    versions.find((v) => v.status === 'published') ??
    versions[0] ??
    null
  );
}

function allowedActionsFor(version: OwnerInvoiceLayoutVersionRow | null): string[] {
  if (!version) {
    return [OWNER_INVOICE_LAYOUT_COMMANDS.create_draft];
  }
  if (version.status === 'draft') {
    return [
      OWNER_INVOICE_LAYOUT_COMMANDS.move_section,
      OWNER_INVOICE_LAYOUT_COMMANDS.resize_section,
      OWNER_INVOICE_LAYOUT_COMMANDS.move_field,
      OWNER_INVOICE_LAYOUT_COMMANDS.set_field_visibility,
      OWNER_INVOICE_LAYOUT_COMMANDS.set_table_column,
      OWNER_INVOICE_LAYOUT_COMMANDS.publish,
      OWNER_INVOICE_LAYOUT_COMMANDS.create_draft,
      OWNER_INVOICE_LAYOUT_COMMANDS.archive,
    ];
  }
  if (version.status === 'published') {
    return [
      OWNER_INVOICE_LAYOUT_COMMANDS.create_draft,
      OWNER_INVOICE_LAYOUT_COMMANDS.archive,
    ];
  }
  return [OWNER_INVOICE_LAYOUT_COMMANDS.create_draft];
}

function sectionConstraints(definition: OwnerInvoiceLayoutDefinitionV1) {
  return definition.sections.map((s) => ({
    section_key: s.key,
    order: s.order,
    zone: s.zone,
    height_px: s.height_px,
    min_height_px: s.min_height_px,
    max_height_px: s.max_height_px,
    col_start: s.col_start,
    col_span: s.col_span,
    alignment: s.alignment,
    visible: s.visible,
    owner_locked: s.owner_locked,
    /** Column/span geometry moves — locked sections stay fixed. */
    move_allowed: !s.owner_locked,
    /** Vertical reorder via order index — allowed for all draft sections. */
    reorder_allowed: true,
    resize_allowed: !s.owner_locked,
  }));
}

export async function buildOwnerInvoiceDocumentBuilderAggregate(
  ctx: RequestContext,
  opts?: {
    layout_key?: string;
    document_type_group?: string;
    country_code?: string | null;
    version_id?: string | null;
    /** Preview-only sample branding (within user_branding_bounds). Does not mutate layout. */
    preview_logo_size_key?: string | null;
    preview_color_theme_key?: string | null;
  },
): Promise<Record<string, unknown>> {
  assertPlatformOwner(ctx);
  const layout_key = opts?.layout_key?.trim() || OWNER_INVOICE_LAYOUT_KEY_DEFAULT;
  const document_type_group = asDocumentTypeGroup(opts?.document_type_group);
  const country_code =
    opts?.country_code === undefined ? 'IL' : asOptionalString(opts.country_code);
  const previewOverrides = {
    logo_size_key: asOptionalString(opts?.preview_logo_size_key),
    color_theme_key: asOptionalString(opts?.preview_color_theme_key),
  };

  const versions = await listVersions({ layout_key, document_type_group, country_code });
  let working =
    opts?.version_id != null && String(opts.version_id).trim()
      ? versions.find((v) => v.id === String(opts.version_id).trim()) ?? null
      : pickWorkingVersion(versions);

  if (!working && versions.length === 0) {
    // Lazy seed: expose GM definition without writing until create_draft.
    const seed = buildSectionedGoldenMasterLayoutDefinitionV1();
    const preview_html = buildOwnerInvoiceLayoutPreviewHtml(seed, previewOverrides);
    return {
      aggregate_key: OWNER_INVOICE_LAYOUT_AGGREGATE_KEY,
      layout_key,
      document_type_group,
      country_code,
      status: null,
      version_number: null,
      version_id: null,
      layout_definition: seed,
      field_catalog: getOwnerInvoiceFieldCatalog(),
      section_constraints: sectionConstraints(seed),
      branding_bounds: seed.user_branding_bounds,
      preview_html,
      preview_sample: {
        logo_size_key: previewOverrides.logo_size_key,
        color_theme_key: previewOverrides.color_theme_key,
        note: 'Preview-only sample branding within Owner bounds. Does not mutate tenant Branding Studio.',
      },
      allowed_actions: allowedActionsFor(null),
      version_history: [],
      lifecycle: { draft: 'mutable', published: 'immutable', archived: 'immutable' },
      notes: {
        legacy_policy:
          'Issued documents without owner_layout_version_id/snapshot keep exact legacy render path.',
        vat_boundary: 'VAT rates are Owner Legal Control / Country Pack only — never in layout JSON.',
      },
    };
  }

  if (!working) throw notFound('Owner invoice layout version not found');

  const definition = working.layout_definition_json;
  const preview_html = buildOwnerInvoiceLayoutPreviewHtml(definition, previewOverrides);

  return {
    aggregate_key: OWNER_INVOICE_LAYOUT_AGGREGATE_KEY,
    layout_key: working.layout_key,
    document_type_group: working.document_type_group,
    country_code: working.country_code,
    status: working.status,
    version_number: working.version_number,
    version_id: working.id,
    based_on_version_id: working.based_on_version_id,
    published_at: working.published_at,
    archived_at: working.archived_at,
    layout_definition: definition,
    field_catalog: getOwnerInvoiceFieldCatalog(),
    section_constraints: sectionConstraints(definition),
    branding_bounds: definition.user_branding_bounds,
    preview_html,
    preview_sample: {
      logo_size_key: previewOverrides.logo_size_key,
      color_theme_key: previewOverrides.color_theme_key,
      note: 'Preview-only sample branding within Owner bounds. Does not mutate tenant Branding Studio.',
    },
    allowed_actions: allowedActionsFor(working),
    version_history: versions.map((v) => ({
      id: v.id,
      version_number: v.version_number,
      status: v.status,
      published_at: v.published_at,
      archived_at: v.archived_at,
      based_on_version_id: v.based_on_version_id,
      created_at: v.created_at,
      updated_at: v.updated_at,
    })),
    lifecycle: { draft: 'mutable', published: 'immutable', archived: 'immutable' },
    notes: {
      legacy_policy:
        'Issued documents without owner_layout_version_id/snapshot keep exact legacy render path.',
      vat_boundary: 'VAT rates are Owner Legal Control / Country Pack only — never in layout JSON.',
    },
  };
}

async function refreshed(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  versionId?: string | null,
): Promise<LayoutCommandResponse['refreshed']> {
  return {
    aggregate_key: OWNER_INVOICE_LAYOUT_AGGREGATE_KEY,
    aggregate: await buildOwnerInvoiceDocumentBuilderAggregate(ctx, {
      layout_key: asOptionalString(payload.layout_key) ?? OWNER_INVOICE_LAYOUT_KEY_DEFAULT,
      document_type_group: asDocumentTypeGroup(payload.document_type_group),
      country_code:
        payload.country_code === undefined ? 'IL' : asOptionalString(payload.country_code),
      version_id: versionId ?? asOptionalString(payload.version_id),
    }),
  };
}

async function nextVersionNumber(params: {
  layout_key: string;
  document_type_group: OwnerInvoiceLayoutDocumentTypeGroup;
}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .select('version_number')
    .eq('layout_key', params.layout_key)
    .eq('document_type_group', params.document_type_group)
    .order('version_number', { ascending: false })
    .limit(1);
  throwIfSupabaseError(error, 'nextOwnerInvoiceLayoutVersionNumber');
  const max = Number((data?.[0] as { version_number?: number } | undefined)?.version_number ?? 0);
  return max + 1;
}

async function persistDefinition(
  ctx: RequestContext,
  version: OwnerInvoiceLayoutVersionRow,
  definition: OwnerInvoiceLayoutDefinitionV1,
  auditAction: string,
  command: OwnerInvoiceLayoutCommand,
  payload: Record<string, unknown>,
): Promise<LayoutCommandResponse> {
  assertOwnerInvoiceLayoutVersionMutable(version.status);
  const { error } = await supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .update({
      layout_definition_json: definition,
      updated_by: ctx.user.id,
    })
    .eq('id', version.id)
    .eq('status', 'draft');
  throwIfSupabaseError(error, 'updateOwnerInvoiceLayoutDraft');
  await auditLayout(ctx, auditAction, version.id, {
    command,
    version_id: version.id,
    version_number: version.version_number,
  });
  return {
    ok: true,
    command,
    refreshed: await refreshed(ctx, payload, version.id),
  };
}

async function handleCreateDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LayoutCommandResponse> {
  const layout_key = asOptionalString(payload.layout_key) ?? OWNER_INVOICE_LAYOUT_KEY_DEFAULT;
  const document_type_group = asDocumentTypeGroup(payload.document_type_group);
  const country_code =
    payload.country_code === undefined ? 'IL' : asOptionalString(payload.country_code);
  const based_on_version_id = asOptionalString(payload.based_on_version_id);

  let definition: OwnerInvoiceLayoutDefinitionV1;
  if (based_on_version_id) {
    const base = await loadVersionById(based_on_version_id);
    definition = base.layout_definition_json;
  } else {
    definition = buildSectionedGoldenMasterLayoutDefinitionV1();
  }

  const version_number = await nextVersionNumber({ layout_key, document_type_group });
  const { data, error } = await supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .insert({
      layout_key,
      version_number,
      document_type_group,
      country_code,
      status: 'draft',
      layout_definition_json: definition,
      based_on_version_id,
      created_by: ctx.user.id,
      updated_by: ctx.user.id,
    })
    .select('*')
    .single();
  throwIfSupabaseError(error, 'createOwnerInvoiceLayoutDraft', {
    migrationHint: '155_owner_invoice_document_layout_versions.sql',
  });
  const row = mapRow(data as Record<string, unknown>);
  await auditLayout(ctx, AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_DRAFT_CREATED, row.id, {
    command: OWNER_INVOICE_LAYOUT_COMMANDS.create_draft,
    version_number: row.version_number,
    based_on_version_id,
  });
  return {
    ok: true,
    command: OWNER_INVOICE_LAYOUT_COMMANDS.create_draft,
    refreshed: await refreshed(ctx, payload, row.id),
  };
}

async function handlePublish(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LayoutCommandResponse> {
  const version_id = asString(payload.version_id, 'version_id');
  const version = await loadVersionById(version_id);
  const siblings = await listVersions({
    layout_key: version.layout_key,
    document_type_group: version.document_type_group,
    country_code: version.country_code,
  });
  const plan = planPublishOwnerInvoiceLayoutVersion({
    target_id: version.id,
    target_status: version.status,
    currently_published_ids: siblings.filter((s) => s.status === 'published').map((s) => s.id),
  });

  const now = new Date().toISOString();
  for (const archiveId of plan.archive_ids) {
    const { error } = await supabaseAdmin
      .from('owner_invoice_document_layout_versions')
      .update({
        status: 'archived',
        archived_at: now,
        updated_by: ctx.user.id,
      })
      .eq('id', archiveId)
      .eq('status', 'published');
    throwIfSupabaseError(error, 'archiveSupersededOwnerInvoiceLayout');
    await auditLayout(ctx, AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_VERSION_ARCHIVED, archiveId, {
      command: OWNER_INVOICE_LAYOUT_COMMANDS.publish,
      reason: 'superseded_by_publish',
      published_version_id: version.id,
    });
  }

  const { error: pubErr } = await supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .update({
      status: 'published',
      published_at: now,
      archived_at: null,
      updated_by: ctx.user.id,
    })
    .eq('id', version.id)
    .eq('status', 'draft');
  throwIfSupabaseError(pubErr, 'publishOwnerInvoiceLayoutVersion');

  await auditLayout(ctx, AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_VERSION_PUBLISHED, version.id, {
    command: OWNER_INVOICE_LAYOUT_COMMANDS.publish,
    version_number: version.version_number,
    superseded_ids: plan.archive_ids,
  });

  return {
    ok: true,
    command: OWNER_INVOICE_LAYOUT_COMMANDS.publish,
    refreshed: await refreshed(ctx, {
      ...payload,
      layout_key: version.layout_key,
      document_type_group: version.document_type_group,
      country_code: version.country_code,
    }, version.id),
  };
}

async function handleArchive(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<LayoutCommandResponse> {
  const version_id = asString(payload.version_id, 'version_id');
  const version = await loadVersionById(version_id);
  if (version.status === 'archived') {
    throw badRequest('Version already archived');
  }
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .update({
      status: 'archived',
      archived_at: now,
      updated_by: ctx.user.id,
    })
    .eq('id', version.id);
  throwIfSupabaseError(error, 'archiveOwnerInvoiceLayoutVersion');
  await auditLayout(ctx, AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_VERSION_ARCHIVED, version.id, {
    command: OWNER_INVOICE_LAYOUT_COMMANDS.archive,
    previous_status: version.status,
  });
  return {
    ok: true,
    command: OWNER_INVOICE_LAYOUT_COMMANDS.archive,
    refreshed: await refreshed(ctx, {
      ...payload,
      layout_key: version.layout_key,
      document_type_group: version.document_type_group,
      country_code: version.country_code,
    }, version.id),
  };
}

async function mutateDraft(
  ctx: RequestContext,
  payload: Record<string, unknown>,
  command: OwnerInvoiceLayoutCommand,
  auditAction: string,
  mutator: (definition: OwnerInvoiceLayoutDefinitionV1) => OwnerInvoiceLayoutDefinitionV1,
): Promise<LayoutCommandResponse> {
  const version_id = asString(payload.version_id, 'version_id');
  const version = await loadVersionById(version_id);
  const next = mutator(version.layout_definition_json);
  return persistDefinition(ctx, version, next, auditAction, command, payload);
}

export async function executeOwnerInvoiceLayoutCommand(
  ctx: RequestContext,
  command: OwnerInvoiceLayoutCommand,
  payload: Record<string, unknown>,
): Promise<LayoutCommandResponse> {
  try {
    assertPlatformOwner(ctx);
  } catch (error) {
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'owner_invoice_document_layout_version',
      action: AUDIT_ACTIONS.OWNER_SECURITY_CHECK_FAILED,
      payload: {
        attempted_command: command,
        reason: error instanceof Error ? error.message : 'platform_owner_guard_failed',
      },
    });
    throw error;
  }

  if (!isOwnerInvoiceLayoutCommand(command)) {
    throw badRequest(`Unsupported owner invoice layout command: ${command}`);
  }

  switch (command) {
    case OWNER_INVOICE_LAYOUT_COMMANDS.create_draft:
      return handleCreateDraft(ctx, payload);
    case OWNER_INVOICE_LAYOUT_COMMANDS.move_section:
      return mutateDraft(
        ctx,
        payload,
        command,
        AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_SECTION_MOVED,
        (def) =>
          moveOwnerInvoiceLayoutSection(def, {
            section_key: asString(payload.section_key, 'section_key'),
            order: payload.order == null ? undefined : Number(payload.order),
            col_start: payload.col_start == null ? undefined : Number(payload.col_start),
          }),
      );
    case OWNER_INVOICE_LAYOUT_COMMANDS.resize_section:
      return mutateDraft(
        ctx,
        payload,
        command,
        AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_SECTION_RESIZED,
        (def) =>
          resizeOwnerInvoiceLayoutSection(def, {
            section_key: asString(payload.section_key, 'section_key'),
            height_px: payload.height_px == null ? undefined : Number(payload.height_px),
            col_span: payload.col_span == null ? undefined : Number(payload.col_span),
          }),
      );
    case OWNER_INVOICE_LAYOUT_COMMANDS.move_field:
      return mutateDraft(
        ctx,
        payload,
        command,
        AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_FIELD_MOVED,
        (def) =>
          moveOwnerInvoiceLayoutField(def, {
            field_key: asString(payload.field_key, 'field_key'),
            section_key: asOptionalString(payload.section_key) ?? undefined,
            order: payload.order == null ? undefined : Number(payload.order),
          }),
      );
    case OWNER_INVOICE_LAYOUT_COMMANDS.set_field_visibility:
      return mutateDraft(
        ctx,
        payload,
        command,
        AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_FIELD_VISIBILITY_SET,
        (def) =>
          setOwnerInvoiceFieldVisibility(def, {
            field_key: asString(payload.field_key, 'field_key'),
            visible: Boolean(payload.visible),
          }),
      );
    case OWNER_INVOICE_LAYOUT_COMMANDS.set_table_column:
      return mutateDraft(
        ctx,
        payload,
        command,
        AUDIT_ACTIONS.OWNER_INVOICE_LAYOUT_TABLE_COLUMN_SET,
        (def) =>
          setOwnerInvoiceTableColumn(def, {
            column_key: asString(payload.column_key, 'column_key'),
            visible: payload.visible == null ? undefined : Boolean(payload.visible),
            width_px:
              payload.width_px === undefined
                ? undefined
                : payload.width_px == null
                  ? null
                  : Number(payload.width_px),
            order: payload.order == null ? undefined : Number(payload.order),
            align:
              payload.align == null
                ? undefined
                : (asString(payload.align, 'align') as 'start' | 'center' | 'end'),
          }),
      );
    case OWNER_INVOICE_LAYOUT_COMMANDS.publish:
      return handlePublish(ctx, payload);
    case OWNER_INVOICE_LAYOUT_COMMANDS.archive:
      return handleArchive(ctx, payload);
    default:
      throw badRequest(`Unsupported owner invoice layout command: ${command}`);
  }
}

/**
 * Resolve active published Owner layout for NEW issue freeze.
 * Returns null → leave freeze columns null (legacy path).
 */
export async function resolveActivePublishedOwnerInvoiceLayoutFreeze(params?: {
  layout_key?: string;
  document_type_group?: OwnerInvoiceLayoutDocumentTypeGroup;
  country_code?: string | null;
}): Promise<OwnerInvoiceLayoutIssueFreeze | null> {
  const layout_key = params?.layout_key ?? OWNER_INVOICE_LAYOUT_KEY_DEFAULT;
  const document_type_group = params?.document_type_group ?? 'all';
  const country_code = params?.country_code === undefined ? 'IL' : params.country_code;

  let q = supabaseAdmin
    .from('owner_invoice_document_layout_versions')
    .select('id, status, layout_definition_json')
    .eq('layout_key', layout_key)
    .eq('document_type_group', document_type_group)
    .eq('status', 'published')
    .limit(1);
  if (country_code == null) {
    q = q.is('country_code', null);
  } else {
    q = q.eq('country_code', country_code);
  }
  const { data, error } = await q.maybeSingle();
  if (error) {
    // Soft: missing table/migration must not break issue — leave legacy null freeze.
    return null;
  }
  return buildOwnerInvoiceLayoutIssueFreezeFromPublished(
    data as { id: string; status: string; layout_definition_json: unknown } | null,
  );
}

/** Tenant users must never call Owner layout mutations. */
export function rejectTenantOwnerInvoiceLayoutMutation(): never {
  throw forbidden('Platform owner access required', 'PLATFORM_OWNER_REQUIRED');
}
