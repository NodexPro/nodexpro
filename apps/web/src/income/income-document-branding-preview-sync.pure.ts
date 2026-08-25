import type {
  IncomeBrandingStudioDraft,
  IncomeDocumentBrandingStudioPreviewDraftResult,
  IncomeDocumentTypeStyleGroupKey,
} from './income-document-branding-types';

/**
 * Stable fingerprint of the preview-draft command body only.
 * Used to avoid treating aggregate hydration / identical writebacks as user edits.
 */
export function fingerprintBrandingPreviewDraftBody(body: Record<string, unknown>): string {
  const overridesRaw = body.document_type_style_overrides;
  const overrides =
    overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)
      ? (overridesRaw as Record<string, unknown>)
      : {};
  const sortedOverrides: Record<string, unknown> = {};
  for (const key of Object.keys(overrides).sort()) {
    sortedOverrides[key] = overrides[key];
  }
  return JSON.stringify({
    ...body,
    document_type_style_overrides: sortedOverrides,
  });
}

export function fingerprintBrandingPreviewDraft(
  draft: IncomeBrandingStudioDraft,
  buildBody: (draft: IncomeBrandingStudioDraft) => Record<string, unknown>,
): string {
  return fingerprintBrandingPreviewDraftBody(buildBody(draft));
}

export function shouldScheduleBrandingPreviewRequest(args: {
  canPreview: boolean;
  busy: boolean;
  draftFingerprint: string;
  lastAppliedFingerprint: string | null;
}): boolean {
  if (!args.canPreview || args.busy) return false;
  if (args.lastAppliedFingerprint === args.draftFingerprint) return false;
  return true;
}

type PreviewSelectionResult = Pick<
  IncomeDocumentBrandingStudioPreviewDraftResult,
  'selected_document_type_group_key' | 'selected_document_style_key' | 'selected_color_theme_key'
>;

/**
 * Apply backend selection echo into draft only when values actually differ.
 * Returning the same object reference prevents a draft-identity feedback loop.
 */
export function mergePreviewDraftSelectionIntoDraft(
  current: IncomeBrandingStudioDraft,
  result: PreviewSelectionResult,
): IncomeBrandingStudioDraft {
  const nextGroup = result.selected_document_type_group_key as IncomeDocumentTypeStyleGroupKey;
  if (
    current.selected_document_type_group_key === nextGroup &&
    current.document_style_key === result.selected_document_style_key &&
    current.color_theme_key === result.selected_color_theme_key
  ) {
    return current;
  }
  return {
    ...current,
    selected_document_type_group_key: nextGroup,
    document_style_key: result.selected_document_style_key,
    color_theme_key: result.selected_color_theme_key,
  };
}
