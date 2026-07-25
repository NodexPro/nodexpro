import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREVIEW_A4_HEIGHT_PX,
  PREVIEW_A4_WIDTH_PX,
  assertIncomePreviewSrcDocNaturalA4,
  buildIncomePreviewScreenIframeSrcDoc,
  resolveCanvasAvailableBox,
  resolvePreviewPaperRootMatchesA4,
  resolveScreenPreviewFitDiagnostics,
  resolveScreenPreviewPlan,
  resolveScreenPreviewPrintTarget,
  resolveScreenPreviewScaleLayers,
} from '../src/components/work-engine/work-engine-income-document-preview-screen.pure.ts';

test('preview_html remains available inside natural A4 iframe srcDoc', () => {
  const marker = '<div class="nx-doc nx-doc--sectioned">HELLO_PREVIEW_HTML</div>';
  const srcDoc = buildIncomePreviewScreenIframeSrcDoc(marker);
  assert.match(srcDoc, /HELLO_PREVIEW_HTML/);
  assert.equal(assertIncomePreviewSrcDocNaturalA4(srcDoc), true);
  assert.doesNotMatch(srcDoc, /transform\s*:\s*scale/i);
  assert.match(srcDoc, /html,body\{[^}]*display:\s*block\s*!important/);
  assert.match(srcDoc, /html,body\{[^}]*overflow:\s*visible\s*!important/);
  assert.doesNotMatch(srcDoc, /html,body\{[^}]*overflow:\s*hidden/);
  assert.match(srcDoc, new RegExp(`\\.nx-doc--sectioned\\{[^}]*height:\\s*${PREVIEW_A4_HEIGHT_PX}px\\s*!important`));
});

test('srcDoc neutralizes renderer 100vh modal-fill on paper root', () => {
  const srcDoc = buildIncomePreviewScreenIframeSrcDoc('<div class="nx-doc--sectioned"></div>');
  assert.match(srcDoc, /min-height:\s*1123px\s*!important/);
  assert.match(srcDoc, /max-height:\s*1123px\s*!important/);
  assert.match(srcDoc, /flex:\s*none\s*!important/);
  assert.doesNotMatch(srcDoc, /html,body\{[^}]*height:\s*1123px/);
});

test('failed / unready fit returns natural scrollable paper — blank impossible', () => {
  assert.equal(resolveScreenPreviewPlan({ iframe_loaded: false, available_width: 800, available_height: 1000 }).mode, 'natural');
  assert.equal(resolveScreenPreviewPlan({ iframe_loaded: true, available_width: 0, available_height: 1000 }).mode, 'natural');
  assert.equal(resolveScreenPreviewPlan({ iframe_loaded: true, available_width: 800, available_height: 0 }).mode, 'natural');
  assert.equal(resolveScreenPreviewPlan({ iframe_loaded: true, available_width: Number.NaN, available_height: 900 }).mode, 'natural');
  assert.equal(resolveScreenPreviewPlan({ iframe_loaded: true, available_width: 1, available_height: 1 }).mode, 'natural');
});

test('single scale layer: shell alone is scaled to available box', () => {
  const plan = resolveScreenPreviewPlan({
    iframe_loaded: true,
    available_width: 400,
    available_height: 2000,
  });
  assert.equal(plan.mode, 'fitted');
  const layers = resolveScreenPreviewScaleLayers(plan);
  assert.equal(layers.iframe_width, PREVIEW_A4_WIDTH_PX);
  assert.equal(layers.iframe_height, PREVIEW_A4_HEIGHT_PX);
  assert.ok(plan.shell_width <= 400);
  assert.ok(plan.shell_height <= 2000);
  assert.notEqual(layers.iframe_width, layers.shell_width);
});

test('canvas available box uses full canvas width minus gutter — not nested shell width', () => {
  const box = resolveCanvasAvailableBox({
    canvas_width: 1160,
    canvas_height: 780,
    horizontal_gutter_px: 8,
    vertical_gutter_px: 8,
  });
  assert.equal(box.available_width, 1152);
  assert.equal(box.available_height, 772);
});

test('at ~1600x900 production-like canvas, scale is height-limited and shell ~500–600 wide', () => {
  const diag = resolveScreenPreviewFitDiagnostics({
    canvas_width: 1176,
    canvas_height: 780,
    horizontal_gutter_px: 8,
    vertical_gutter_px: 8,
  });
  assert.equal(diag.limiting_axis, 'height');
  assert.ok(diag.width_scale > diag.height_scale);
  assert.ok(diag.selected_scale > 0.55);
  assert.ok(diag.shell_width >= 500);
  assert.ok(diag.shell_width <= 620);
  assert.ok(diag.shell_height <= diag.available_height);
});

test('paper root matches A4 only at 794×1123 with top origin', () => {
  assert.equal(resolvePreviewPaperRootMatchesA4({ width: 794, height: 1123, top: 0 }), true);
  assert.equal(resolvePreviewPaperRootMatchesA4({ width: 794, height: 1200, top: 0 }), false);
  assert.equal(resolvePreviewPaperRootMatchesA4({ width: 794, height: 1123, top: -40 }), false);
});

test('fitted shell never exceeds available box (no top/bottom clip)', () => {
  const available_width = 860;
  const available_height = 640;
  const plan = resolveScreenPreviewPlan({
    iframe_loaded: true,
    available_width,
    available_height,
  });
  assert.equal(plan.mode, 'fitted');
  assert.ok(plan.shell_width <= available_width);
  assert.ok(plan.shell_height <= available_height);
  assert.equal(plan.paper_width, PREVIEW_A4_WIDTH_PX);
  assert.equal(plan.paper_height, PREVIEW_A4_HEIGHT_PX);
});

test('printing always targets original A4 source, not fitted representation', () => {
  assert.equal(resolveScreenPreviewPrintTarget('natural'), 'source_paper');
  assert.equal(resolveScreenPreviewPrintTarget('fitted'), 'source_paper');
});
