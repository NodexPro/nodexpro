import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assessLogoAspectForWideFrame,
  formatLogoAspectRatioLabel,
  probeLogoImageDimensions,
  WIDE_LOGO_MIN_ASPECT_RATIO,
  WIDE_LOGO_RECOMMENDED_UPLOAD,
} from '../../src/domains/income/income-document-logo-aspect-guidance.pure.js';
import { encodeRgbaPng } from '../../src/domains/income/income-document-logo-png.pure.js';

function solidPngDataUrl(width: number, height: number): string {
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 40;
    rgba[i * 4 + 1] = 20;
    rgba[i * 4 + 2] = 120;
    rgba[i * 4 + 3] = 255;
  }
  const png = encodeRgbaPng(rgba, width, height);
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('income document logo aspect guidance', () => {
  test('recommended upload matches wide frame aspect (~5.3∶1)', () => {
    const { width_px, height_px } = WIDE_LOGO_RECOMMENDED_UPLOAD;
    assert.equal(width_px, 1288);
    assert.equal(height_px, 244);
    assert.ok(Math.abs(width_px / height_px - 322 / 61) < 0.01);
    assert.equal(WIDE_LOGO_MIN_ASPECT_RATIO, 3);
  });

  test('probes PNG dimensions from buffer', () => {
    const png = encodeRgbaPng(Buffer.alloc(10 * 4 * 4, 255), 10, 4);
    const dims = probeLogoImageDimensions('image/png', png);
    assert.deepEqual(dims, { width_px: 10, height_px: 4 });
  });

  test('warns for square logo under 3∶1 without rejecting', () => {
    const assessment = assessLogoAspectForWideFrame(solidPngDataUrl(500, 500));
    assert.equal(assessment.width_px, 500);
    assert.equal(assessment.height_px, 500);
    assert.equal(assessment.aspect_ratio, 1);
    assert.equal(assessment.aspect_ratio_label, formatLogoAspectRatioLabel(1));
    assert.equal(assessment.narrow_for_wide_frame, true);
    assert.ok(assessment.aspect_ratio_warning);
    assert.match(assessment.aspect_ratio_warning!, /≈ 5\.3∶1/);
    assert.match(assessment.aspect_ratio_warning!, /1288×244/);
    assert.match(assessment.aspect_ratio_warning!, /אזהרה בלבד/);
  });

  test('does not warn for wide horizontal lockup', () => {
    const assessment = assessLogoAspectForWideFrame(solidPngDataUrl(1288, 244));
    assert.equal(assessment.narrow_for_wide_frame, false);
    assert.equal(assessment.aspect_ratio_warning, null);
    assert.ok(assessment.aspect_ratio! > WIDE_LOGO_MIN_ASPECT_RATIO);
  });

  test('missing logo yields empty assessment', () => {
    const assessment = assessLogoAspectForWideFrame(null);
    assert.equal(assessment.aspect_ratio_warning, null);
    assert.equal(assessment.narrow_for_wide_frame, false);
    assert.equal(assessment.width_px, null);
  });
});
