import type { RequestContext } from '../../shared/context.js';
import { optionalUuid, type ActiveIncomeIssuerScope } from './income.guards.js';
import {
  refreshWizardDraftOverlayAfterBranding,
  type WizardDraftOverlay,
} from './income-document-draft-editor.service.js';
import {
  updateIncomeDocumentBrandingProfile,
  uploadIncomeDocumentLogo,
  uploadIncomeDocumentSignature,
} from './income-document-branding.service.js';

export async function executeUpdateIncomeDocumentBrandingProfile(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  await updateIncomeDocumentBrandingProfile(scope, body);
  const draft_id = optionalUuid(body.draft_id, 'draft_id');
  if (!draft_id) return { document_details_step: null };
  return refreshWizardDraftOverlayAfterBranding(scope, draft_id);
}

export async function executeUploadIncomeDocumentLogo(
  ctx: RequestContext,
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  await uploadIncomeDocumentLogo(ctx, scope, body);
  const draft_id = optionalUuid(body.draft_id, 'draft_id');
  if (!draft_id) return { document_details_step: null };
  return refreshWizardDraftOverlayAfterBranding(scope, draft_id);
}

export async function executeUploadIncomeDocumentSignature(
  ctx: RequestContext,
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  await uploadIncomeDocumentSignature(ctx, scope, body);
  const draft_id = optionalUuid(body.draft_id, 'draft_id');
  if (!draft_id) return { document_details_step: null };
  return refreshWizardDraftOverlayAfterBranding(scope, draft_id);
}
