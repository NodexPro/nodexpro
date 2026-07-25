/**
 * Preview chrome only — screen-fit via a separate iframe representation.
 * Never scales the live preview_html paper DOM.
 * Exactly one scale layer: transform on a wrapper; shell reserves scaled box.
 *
 * Available box MUST be measured from the preview canvas (full modal body),
 * never from shell / scaler / iframe / document content width.
 */

export const PREVIEW_A4_WIDTH_PX = 794;
export const PREVIEW_A4_HEIGHT_PX = 1123;
export const PREVIEW_SCREEN_FIT_SCALE_MIN = 0.1;
export const PREVIEW_SCREEN_FIT_SCALE_MAX = 1;
/** Tiny gutter so the fitted page never kisses overflow:hidden edges. */
export const PREVIEW_SCREEN_FIT_GUTTER_PX = 8;

export const PREVIEW_PAPER_ROOT_SELECTOR = '.nx-doc';

export type ScreenPreviewMode = 'natural' | 'fitted';

export type ScreenPreviewPlan = {
  mode: ScreenPreviewMode;
  scale: number;
  shell_width: number;
  shell_height: number;
  paper_width: number;
  paper_height: number;
};

export type ScreenPreviewFitDiagnostics = {
  canvas_width: number;
  canvas_height: number;
  available_width: number;
  available_height: number;
  width_scale: number;
  height_scale: number;
  selected_scale: number;
  shell_width: number;
  shell_height: number;
  limiting_axis: 'width' | 'height' | 'max' | 'none';
};

export type ScreenPreviewPaperRootSize = {
  width: number;
  height: number;
  top: number;
  left: number;
  matches_a4: boolean;
};

const NATURAL_PLAN: ScreenPreviewPlan = {
  mode: 'natural',
  scale: 1,
  shell_width: PREVIEW_A4_WIDTH_PX,
  shell_height: PREVIEW_A4_HEIGHT_PX,
  paper_width: PREVIEW_A4_WIDTH_PX,
  paper_height: PREVIEW_A4_HEIGHT_PX,
};

/**
 * Same-origin iframe document chrome.
 * Does NOT force html/body to 1123 + overflow:hidden up front (that clips the paper root).
 * Neutralizes renderer modal-fill rules (100vh min-height) for the fixed A4 iframe viewport.
 */
export function buildIncomePreviewScreenIframeSrcDoc(previewHtml: string): string {
  const body = typeof previewHtml === 'string' ? previewHtml : '';
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"/><style>
html,body{
  margin:0 !important;
  padding:0 !important;
  display:block !important;
  align-items:initial !important;
  justify-content:initial !important;
  transform:none !important;
  position:static !important;
  top:auto !important;
  width:${PREVIEW_A4_WIDTH_PX}px !important;
  min-width:${PREVIEW_A4_WIDTH_PX}px !important;
  max-width:${PREVIEW_A4_WIDTH_PX}px !important;
  height:auto !important;
  min-height:0 !important;
  max-height:none !important;
  overflow:visible !important;
  background:#ffffff !important;
  zoom:normal !important;
}
/* Paper root must be exact A4 in the iframe — not modal 100vh fill. */
.nx-doc,
.nx-doc--unified,
.nx-doc--sectioned{
  width:${PREVIEW_A4_WIDTH_PX}px !important;
  max-width:${PREVIEW_A4_WIDTH_PX}px !important;
  min-width:${PREVIEW_A4_WIDTH_PX}px !important;
  height:${PREVIEW_A4_HEIGHT_PX}px !important;
  min-height:${PREVIEW_A4_HEIGHT_PX}px !important;
  max-height:${PREVIEW_A4_HEIGHT_PX}px !important;
  margin:0 !important;
  margin-block:0 !important;
  margin-inline:0 !important;
  flex:none !important;
  position:relative !important;
  top:0 !important;
  left:auto !important;
  right:auto !important;
  transform:none !important;
  translate:none !important;
  box-sizing:border-box !important;
  overflow:hidden !important;
}
</style></head><body>${body}</body></html>`;
}

/** True when srcDoc keeps natural A4 width and does not introduce a second scale layer. */
export function assertIncomePreviewSrcDocNaturalA4(srcDoc: string): boolean {
  if (/transform\s*:\s*scale|zoom\s*:\s*[0-9.]|object-fit\s*:\s*contain/i.test(srcDoc)) {
    return false;
  }
  if (!new RegExp(`min-width:\\s*${PREVIEW_A4_WIDTH_PX}px`).test(srcDoc)) return false;
  /* Must not clip via premature html/body height+overflow before paper-root lock. */
  if (/html,body\{[^}]*overflow:\s*hidden/i.test(srcDoc)) return false;
  if (/html,body\{[^}]*height:\s*1123px/i.test(srcDoc)) return false;
  /* Paper root must be forced to A4 inside the iframe (neutralizes 100vh modal-fill). */
  if (!new RegExp(`height:\\s*${PREVIEW_A4_HEIGHT_PX}px\\s*!important`).test(srcDoc)) return false;
  if (!/\.nx-doc/.test(srcDoc)) return false;
  return true;
}

export function resolvePreviewPaperRootMatchesA4(size: {
  width: number;
  height: number;
  top?: number;
}): boolean {
  const topOk = size.top == null || Math.abs(size.top) < 1;
  return (
    topOk &&
    Math.round(size.width) === PREVIEW_A4_WIDTH_PX &&
    Math.round(size.height) === PREVIEW_A4_HEIGHT_PX
  );
}

/** Derive available box from the full canvas rect (never from nested fit chrome). */
export function resolveCanvasAvailableBox(input: {
  canvas_width: number;
  canvas_height: number;
  horizontal_gutter_px?: number;
  vertical_gutter_px?: number;
}): { available_width: number; available_height: number } {
  const hg = Number.isFinite(input.horizontal_gutter_px)
    ? Math.max(0, input.horizontal_gutter_px as number)
    : PREVIEW_SCREEN_FIT_GUTTER_PX;
  const vg = Number.isFinite(input.vertical_gutter_px)
    ? Math.max(0, input.vertical_gutter_px as number)
    : PREVIEW_SCREEN_FIT_GUTTER_PX;
  return {
    available_width: Math.floor(input.canvas_width - hg),
    available_height: Math.floor(input.canvas_height - vg),
  };
}

/**
 * Fit diagnostics for A4 794×1123 against a canvas-measured available box.
 * scale = min(availableWidth/794, availableHeight/1123, 1)
 */
export function resolveScreenPreviewFitDiagnostics(input: {
  canvas_width: number;
  canvas_height: number;
  horizontal_gutter_px?: number;
  vertical_gutter_px?: number;
}): ScreenPreviewFitDiagnostics {
  const { available_width, available_height } = resolveCanvasAvailableBox(input);
  if (!(available_width > 0) || !(available_height > 0)) {
    return {
      canvas_width: input.canvas_width,
      canvas_height: input.canvas_height,
      available_width,
      available_height,
      width_scale: 0,
      height_scale: 0,
      selected_scale: 0,
      shell_width: PREVIEW_A4_WIDTH_PX,
      shell_height: PREVIEW_A4_HEIGHT_PX,
      limiting_axis: 'none',
    };
  }

  const width_scale = available_width / PREVIEW_A4_WIDTH_PX;
  const height_scale = available_height / PREVIEW_A4_HEIGHT_PX;
  const selected_scale = Math.min(PREVIEW_SCREEN_FIT_SCALE_MAX, width_scale, height_scale);
  const shell_width = Math.max(1, Math.floor(PREVIEW_A4_WIDTH_PX * selected_scale));
  const shell_height = Math.max(1, Math.floor(PREVIEW_A4_HEIGHT_PX * selected_scale));

  let limiting_axis: ScreenPreviewFitDiagnostics['limiting_axis'] = 'max';
  if (selected_scale < PREVIEW_SCREEN_FIT_SCALE_MAX) {
    limiting_axis = height_scale <= width_scale ? 'height' : 'width';
  }

  return {
    canvas_width: input.canvas_width,
    canvas_height: input.canvas_height,
    available_width,
    available_height,
    width_scale,
    height_scale,
    selected_scale,
    shell_width,
    shell_height,
    limiting_axis,
  };
}

/**
 * Fit plan for the outer shell only.
 * Paper size is always natural A4 794×1123.
 */
export function resolveScreenPreviewPlan(input: {
  iframe_loaded: boolean;
  available_width: number;
  available_height: number;
  gutter_px?: number;
}): ScreenPreviewPlan {
  if (!input.iframe_loaded) {
    return { ...NATURAL_PLAN };
  }

  const gutter = Number.isFinite(input.gutter_px)
    ? Math.max(0, input.gutter_px as number)
    : 0;
  const aw = Math.floor(input.available_width - gutter);
  const ah = Math.floor(input.available_height - gutter);
  if (!(aw > 0) || !(ah > 0)) {
    return { ...NATURAL_PLAN };
  }

  const width_scale = aw / PREVIEW_A4_WIDTH_PX;
  const height_scale = ah / PREVIEW_A4_HEIGHT_PX;
  const raw = Math.min(PREVIEW_SCREEN_FIT_SCALE_MAX, width_scale, height_scale);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { ...NATURAL_PLAN };
  }

  const scale = Math.min(
    PREVIEW_SCREEN_FIT_SCALE_MAX,
    Math.max(PREVIEW_SCREEN_FIT_SCALE_MIN, raw),
  );

  const shell_width = Math.max(1, Math.floor(PREVIEW_A4_WIDTH_PX * scale));
  const shell_height = Math.max(1, Math.floor(PREVIEW_A4_HEIGHT_PX * scale));

  if (shell_width > aw || shell_height > ah) {
    return { ...NATURAL_PLAN };
  }

  return {
    mode: 'fitted',
    scale,
    shell_width,
    shell_height,
    paper_width: PREVIEW_A4_WIDTH_PX,
    paper_height: PREVIEW_A4_HEIGHT_PX,
  };
}

/** Single scale layer contract: iframe stays natural A4; shell alone uses scaled px. */
export function resolveScreenPreviewScaleLayers(plan: ScreenPreviewPlan): {
  iframe_width: number;
  iframe_height: number;
  shell_width: number;
  shell_height: number;
  transform_scale: number;
} {
  return {
    iframe_width: PREVIEW_A4_WIDTH_PX,
    iframe_height: PREVIEW_A4_HEIGHT_PX,
    shell_width: plan.mode === 'fitted' ? plan.shell_width : PREVIEW_A4_WIDTH_PX,
    shell_height: plan.mode === 'fitted' ? plan.shell_height : PREVIEW_A4_HEIGHT_PX,
    transform_scale: plan.mode === 'fitted' ? plan.scale : 1,
  };
}

/** Print / PDF must use the live source paper, never the fitted iframe. */
export function resolveScreenPreviewPrintTarget(mode: ScreenPreviewMode): 'source_paper' | 'fitted_iframe' {
  void mode;
  return 'source_paper';
}
