import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  ensureClientDocumentFolders,
  uploadClientWorkspaceDocument,
} from './client-documents-tab.service.js';
import {
  filingEvidenceFolderSystemKey,
  isFilingEvidenceKind,
  isFilingEvidenceObligationKind,
  niDeductionsEvidenceCanonicalId,
  type FilingEvidenceObligationKind,
} from './client-operations-filing-evidence.pure.js';
import { isIncomeTaxFrequencyApplicableForOperationalPeriod } from './client-operations-operational-period.pure.js';
import { formatReportingPeriodDisplayLabel, vatFilingPeriodIdentityForOperationalPeriod } from './client-operations-reporting-dashboard.pure.js';
import type { FilingEvidenceRow } from './client-operations-filing-evidence.pure.js';

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

export async function assertSelectedTabMatchesObligation(input: {
  organizationId: string;
  clientId: string;
  obligationType: string;
  obligationPeriodKey: string;
  operationalPeriodKey: string;
}): Promise<void> {
  const { data: tax } = await supabaseAdmin
    .from('client_tax_settings')
    .select('vat_frequency, income_tax_advance_frequency')
    .eq('organization_id', input.organizationId)
    .eq('client_id', input.clientId)
    .maybeSingle();
  const settings = (tax ?? null) as {
    vat_frequency?: string | null;
    income_tax_advance_frequency?: string | null;
  } | null;
  if (input.obligationType === 'vat_report') {
    const expected = vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: settings?.vat_frequency ?? null,
      operational_period_key: input.operationalPeriodKey,
    })?.period_key ?? null;
    if (!expected || input.obligationPeriodKey !== expected) {
      throw badRequest('obligation does not match the selected reporting period');
    }
    return;
  }
  if (input.obligationType === 'income_tax_advance') {
    if (
      input.obligationPeriodKey !== input.operationalPeriodKey ||
      !isIncomeTaxFrequencyApplicableForOperationalPeriod(
        settings?.income_tax_advance_frequency,
        input.operationalPeriodKey,
      )
    ) {
      throw badRequest('obligation does not match the selected reporting period');
    }
  }
}

const MONTH_PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

async function attachNiDeductionsFilingEvidence(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  evidenceKind: 'filing' | 'payment',
  operationalPeriodKey: string,
  body: { file_base64?: unknown; file_name?: unknown; mime_type?: unknown },
): Promise<void> {
  if (!MONTH_PERIOD_RE.test(operationalPeriodKey)) {
    throw badRequest('obligation does not match the selected reporting period');
  }
  const { data: tax } = await supabaseAdmin
    .from('client_tax_settings')
    .select('national_insurance_deductions_file_number')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  const fileNumber = String(
    (tax as { national_insurance_deductions_file_number?: string | null } | null)
      ?.national_insurance_deductions_file_number ?? '',
  ).trim();
  if (!fileNumber) throw badRequest('NI deductions are not applicable for this period');

  const { data: periodRow } = await supabaseAdmin
    .from('client_ni_deductions_period')
    .select('id, period_key')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('period_key', operationalPeriodKey)
    .maybeSingle();

  const uploaded = await uploadClientWorkspaceDocument(ctx, orgId, clientId, {
    file_base64: typeof body.file_base64 === 'string' ? body.file_base64 : '',
    file_name: typeof body.file_name === 'string' ? body.file_name : '',
    mime_type: typeof body.mime_type === 'string' ? body.mime_type : null,
  });
  await ensureClientDocumentFolders(orgId, clientId);
  const systemKey = filingEvidenceFolderSystemKey('national_insurance_deductions');
  const { data: folder, error: folderError } = await supabaseAdmin
    .from('client_document_folders')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('system_key', systemKey)
    .is('archived_at', null)
    .maybeSingle();
  if (folderError || !folder) throw badRequest('filing evidence folder is not available');

  const canonicalId = niDeductionsEvidenceCanonicalId(operationalPeriodKey);
  const { error: insertError } = await supabaseAdmin.from('client_documents').insert({
    organization_id: orgId,
    client_id: clientId,
    folder_id: (folder as { id: string }).id,
    file_asset_id: uploaded.file_asset_id,
    display_label_he: uploaded.file_name,
    uploaded_by_user_id: ctx.user.id,
    evidence_kind: evidenceKind,
    obligation_id: (periodRow as { id?: string } | null)?.id ?? null,
    obligation_canonical_id: canonicalId,
    operational_period_key: operationalPeriodKey,
    reporting_period_key: operationalPeriodKey,
    filing_kind: 'national_insurance_deductions',
  });
  if (insertError) throw badRequest('filing evidence storage is not ready');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_documents_workspace',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: {
      client_id: clientId,
      obligation_canonical_id: canonicalId,
      operational_period_key: operationalPeriodKey,
      reporting_period_key: operationalPeriodKey,
      filing_kind: 'national_insurance_deductions',
      evidence_kind: evidenceKind,
      file_asset_id: uploaded.file_asset_id,
      proves_filing: false,
      proves_payment: false,
      replaces_ni_commands: false,
    },
  });
}

/**
 * Attach optional evidence to the obligation resolved from the selected tab.
 * Upload reuses client-files storage and the client documents workspace.
 * The file does not mark the obligation filed or paid.
 */
export async function attachClientOperationsFilingEvidence(
  ctx: RequestContext,
  body: {
    client_id?: unknown;
    obligation_id?: unknown;
    filing_target?: unknown;
    evidence_kind?: unknown;
    operational_period_key?: unknown;
    file_base64?: unknown;
    file_name?: unknown;
    mime_type?: unknown;
  },
): Promise<void> {
  const orgId = assertOrg(ctx);
  const clientId = String(body.client_id ?? '').trim();
  const obligationId = String(body.obligation_id ?? '').trim();
  const filingTarget = String(body.filing_target ?? '').trim();
  const evidenceKind = String(body.evidence_kind ?? '').trim();
  const operationalPeriodKey = String(body.operational_period_key ?? '').trim();
  if (!clientId || !operationalPeriodKey) throw badRequest('filing evidence target required');
  if (!isFilingEvidenceKind(evidenceKind)) throw badRequest('evidence_kind required');
  if (filingTarget === 'national_insurance_deductions') {
    await attachNiDeductionsFilingEvidence(ctx, orgId, clientId, evidenceKind, operationalPeriodKey, body);
    return;
  }
  if (!obligationId) throw badRequest('filing evidence target required');

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (!client) throw forbidden('Client not found');

  const { data: obligation, error: obError } = await supabaseAdmin
    .from('client_obligations')
    .select('id, obligation_type, period_key')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', obligationId)
    .maybeSingle();
  if (obError) throw new AppError(500, obError.message ?? 'obligation load failed', 'SUPABASE_ERROR');
  if (!obligation) throw badRequest('obligation not found');

  const obligationType = String((obligation as { obligation_type?: string }).obligation_type ?? '');
  const periodKey = String((obligation as { period_key?: string }).period_key ?? '');
  const kind: FilingEvidenceObligationKind | null =
    obligationType === 'vat_report'
      ? 'vat'
      : obligationType === 'income_tax_advance'
        ? 'income_tax_advance'
        : null;
  if (obligationType === 'national_insurance_self_employed_payment') {
    throw badRequest('self-employed national insurance does not accept filing evidence');
  }
  if (!kind || !isFilingEvidenceObligationKind(kind)) {
    throw badRequest('obligation type does not accept filing evidence');
  }

  await assertSelectedTabMatchesObligation({
    organizationId: orgId,
    clientId,
    obligationType,
    obligationPeriodKey: periodKey,
    operationalPeriodKey,
  });

  const uploaded = await uploadClientWorkspaceDocument(ctx, orgId, clientId, {
    file_base64: typeof body.file_base64 === 'string' ? body.file_base64 : '',
    file_name: typeof body.file_name === 'string' ? body.file_name : '',
    mime_type: typeof body.mime_type === 'string' ? body.mime_type : null,
  });
  await ensureClientDocumentFolders(orgId, clientId);
  const systemKey = filingEvidenceFolderSystemKey(kind);
  const { data: folder, error: folderError } = await supabaseAdmin
    .from('client_document_folders')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('system_key', systemKey)
    .is('archived_at', null)
    .maybeSingle();
  if (folderError || !folder) throw badRequest('filing evidence folder is not available');

  const canonicalId = `${obligationType}::${periodKey}`;
  const { error: insertError } = await supabaseAdmin.from('client_documents').insert({
    organization_id: orgId,
    client_id: clientId,
    folder_id: (folder as { id: string }).id,
    file_asset_id: uploaded.file_asset_id,
    display_label_he: uploaded.file_name,
    uploaded_by_user_id: ctx.user.id,
    evidence_kind: evidenceKind,
    obligation_id: obligationId,
    obligation_canonical_id: canonicalId,
    operational_period_key: operationalPeriodKey,
    reporting_period_key: periodKey,
    filing_kind: kind,
  });
  if (insertError) {
    throw badRequest('filing evidence storage is not ready');
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_documents_workspace',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: {
      client_id: clientId,
      obligation_id: obligationId,
      obligation_canonical_id: canonicalId,
      operational_period_key: operationalPeriodKey,
      reporting_period_key: periodKey,
      filing_kind: kind,
      evidence_kind: evidenceKind,
      file_asset_id: uploaded.file_asset_id,
      proves_filing: false,
      proves_payment: false,
    },
  });
}

export async function loadClientOperationsFilingEvidenceByClient(input: {
  organizationId: string;
  clientIds: readonly string[];
}): Promise<Map<string, FilingEvidenceRow[]>> {
  const out = new Map<string, FilingEvidenceRow[]>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_documents')
    .select('id, client_id, file_asset_id, evidence_kind, obligation_canonical_id, reporting_period_key, created_at, file_assets(file_name)')
    .eq('organization_id', input.organizationId)
    .in('client_id', [...input.clientIds])
    .is('deleted_at', null)
    .not('obligation_canonical_id', 'is', null);
  if (error || !data) return out;
  for (const row of data as Array<{
    id: string;
    client_id: string;
    file_asset_id: string | null;
    evidence_kind: string | null;
    obligation_canonical_id: string | null;
    reporting_period_key: string | null;
    created_at: string | null;
    file_assets: { file_name: string | null } | { file_name: string | null }[] | null;
  }>) {
    if (row.evidence_kind !== 'filing' && row.evidence_kind !== 'payment') continue;
    const canonicalId = String(row.obligation_canonical_id ?? '').trim();
    const periodKey = String(row.reporting_period_key ?? '').trim();
    if (!canonicalId || !periodKey) continue;
    const asset = row.file_assets;
    const fileName = Array.isArray(asset) ? asset[0]?.file_name ?? null : asset?.file_name ?? null;
    const list = out.get(row.client_id) ?? [];
    list.push({
      document_id: row.id,
      file_asset_id: row.file_asset_id,
      file_name: fileName,
      evidence_kind: row.evidence_kind,
      obligation_canonical_id: canonicalId,
      reporting_period_key: periodKey,
      reporting_period_display: formatReportingPeriodDisplayLabel(periodKey),
      uploaded_at: row.created_at,
    });
    out.set(row.client_id, list);
  }
  return out;
}
