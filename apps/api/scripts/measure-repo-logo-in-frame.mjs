/**
 * How large is the repo logo's VISIBLE artwork when placed in the current
 * sectioned logo frame with object-fit: contain?
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgbaDetailed } from '../src/domains/income/income-document-logo-png.pure.ts';
import {
  findVisibleLogoBounds,
  prepareLogoDataUrlForDocumentRenderDetailed,
} from '../src/domains/income/income-document-logo-visible-fit.pure.ts';
import { SECTIONED_GOLDEN_MASTER as GM } from '../src/domains/income/income-document-sectioned-golden-master.pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const logoPath = path.join(ROOT, 'apps/web/src/templates/template-1/assets/nodexpro-logo.png');
const buf = readFileSync(logoPath);
const raw = decodePngToRgbaDetailed(buf);
const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
const prep = prepareLogoDataUrlForDocumentRenderDetailed(dataUrl);

const frameW = GM.upper.logo_block_width_px;
const frameH = GM.upper.logo_block_height_px;

function visibleFromDataUrl(url) {
  const m = /^data:image\/png;base64,(.+)$/.exec(url);
  if (!m) return null;
  const decoded = decodePngToRgbaDetailed(Buffer.from(m[1], 'base64'));
  if (!decoded.ok) return null;
  const bounds = findVisibleLogoBounds(decoded.image.data, decoded.image.width, decoded.image.height, 10);
  return {
    canvas: { w: decoded.image.width, h: decoded.image.height },
    visible: bounds,
  };
}

const afterPrep = visibleFromDataUrl(prep.data_url);
const contentW = afterPrep?.visible?.width ?? afterPrep?.canvas.w;
const contentH = afterPrep?.visible?.height ?? afterPrep?.canvas.h;

// object-fit: contain into frame
const scale = Math.min(frameW / contentW, frameH / contentH);
const renderedW = contentW * scale;
const renderedH = contentH * scale;

// GM targets from sibling script (will print after)
console.log(
  JSON.stringify(
    {
      raw_ok: raw.ok,
      raw_canvas: raw.ok ? { w: raw.image.width, h: raw.image.height } : null,
      prep: {
        trim_status: prep.trim_status,
        original: { w: prep.original_width, h: prep.original_height },
        cropped: { w: prep.cropped_width, h: prep.cropped_height },
      },
      after_prep_visible: afterPrep,
      frame: { w: frameW, h: frameH },
      contain_rendered_artwork: {
        width: +renderedW.toFixed(1),
        height: +renderedH.toFixed(1),
        area: Math.round(renderedW * renderedH),
        scale: +scale.toFixed(4),
      },
      note: 'If rendered artwork is much smaller than GM logo artwork, frame/height is wrong or asset aspect forces letterboxing.',
    },
    null,
    2,
  ),
);
