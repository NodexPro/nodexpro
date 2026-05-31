import { optionalUuid } from './income.guards.js';
import { refreshWizardDraftOverlayAfterBranding, } from './income-document-draft-editor.service.js';
import { updateIncomeDocumentBrandingProfile, previewIncomeDocumentBrandingProfileDraft, uploadIncomeDocumentLogo, uploadIncomeDocumentSignature, } from './income-document-branding.service.js';
export async function executeUpdateIncomeDocumentBrandingProfilePreviewDraft(scope, body) {
    return previewIncomeDocumentBrandingProfileDraft(scope, body);
}
export async function executeUpdateIncomeDocumentBrandingProfile(scope, body) {
    await updateIncomeDocumentBrandingProfile(scope, body);
    const draft_id = optionalUuid(body.draft_id, 'draft_id');
    if (!draft_id)
        return { document_details_step: null };
    return refreshWizardDraftOverlayAfterBranding(scope, draft_id);
}
export async function executeUploadIncomeDocumentLogo(ctx, scope, body) {
    await uploadIncomeDocumentLogo(ctx, scope, body);
    const draft_id = optionalUuid(body.draft_id, 'draft_id');
    if (!draft_id)
        return { document_details_step: null };
    return refreshWizardDraftOverlayAfterBranding(scope, draft_id);
}
export async function executeUploadIncomeDocumentSignature(ctx, scope, body) {
    await uploadIncomeDocumentSignature(ctx, scope, body);
    const draft_id = optionalUuid(body.draft_id, 'draft_id');
    if (!draft_id)
        return { document_details_step: null };
    return refreshWizardDraftOverlayAfterBranding(scope, draft_id);
}
