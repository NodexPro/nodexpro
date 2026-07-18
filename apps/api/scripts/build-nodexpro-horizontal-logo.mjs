/**
 * Build apps/web/src/templates/template-1/assets/nodexpro-logo.png
 * as a tight 1288×244 transparent horizontal lockup.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { decodePngToRgbaDetailed, encodeRgbaPng } = await import(
  '../src/domains/income/income-document-logo-png.pure.ts'
);
const { findVisibleLogoBounds, cropRgbaToBounds } = await import(
  '../src/domains/income/income-document-logo-visible-fit.pure.ts'
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'apps/web/src/templates/template-1/assets/nodexpro-logo.png');
const TARGET_W = 1288;
const TARGET_H = 244;
const PAD = 0.025;

const candidates = [
  path.join(ROOT, 'New folder/ChatGPT Image Jul 18, 2026, 11_06_22 AM.png'),
  path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/c-Users-hatoo-OneDrive-Zentax/assets/nodexpro-logo-horizontal-source.png',
  ),
];

function isBgPixel(r, g, b, a) {
  if (a < 12) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // Near-white / light gray plate
  return max >= 232 && min >= 220 && max - min <= 28;
}

/** Flood-fill from edges: turn connected background into transparent. */
function clearBackgroundFromEdges(rgba, width, height) {
  const out = Buffer.from(rgba);
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i]) return;
    const o = i * 4;
    if (!isBgPixel(out[o], out[o + 1], out[o + 2], out[o + 3])) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const o = i * 4;
    out[o + 3] = 0;
    const x = i % width;
    const y = (i / width) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  // Soften remaining near-white interior crumbs
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (isBgPixel(out[o], out[o + 1], out[o + 2], out[o + 3])) out[o + 3] = 0;
  }
  return out;
}

function bilinearScale(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y += 1) {
    const fy = ((y + 0.5) * srcH) / dstH - 0.5;
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
    const ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < dstW; x += 1) {
      const fx = ((x + 0.5) * srcW) / dstW - 0.5;
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
      const tx = Math.max(0, Math.min(1, fx - x0));
      const di = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const v00 = src[(y0 * srcW + x0) * 4 + c];
        const v10 = src[(y0 * srcW + x1) * 4 + c];
        const v01 = src[(y1 * srcW + x0) * 4 + c];
        const v11 = src[(y1 * srcW + x1) * 4 + c];
        const v0 = v00 * (1 - tx) + v10 * tx;
        const v1 = v01 * (1 - tx) + v11 * tx;
        out[di + c] = Math.round(v0 * (1 - ty) + v1 * ty);
      }
    }
  }
  return out;
}

const sourcePath = candidates.find((p) => existsSync(p));
if (!sourcePath) {
  console.error('No horizontal source found');
  process.exit(1);
}

const decoded = decodePngToRgbaDetailed(readFileSync(sourcePath));
if (!decoded.ok) {
  console.error(decoded);
  process.exit(1);
}

const cleaned = clearBackgroundFromEdges(
  decoded.image.data,
  decoded.image.width,
  decoded.image.height,
);
const bounds = findVisibleLogoBounds(cleaned, decoded.image.width, decoded.image.height, 10);
if (!bounds) {
  console.error('No visible bounds after background clear');
  process.exit(1);
}
const cropped = cropRgbaToBounds(cleaned, decoded.image.width, bounds);

const innerW = Math.floor(TARGET_W * (1 - 2 * PAD));
const innerH = Math.floor(TARGET_H * (1 - 2 * PAD));
const scale = Math.min(innerW / bounds.width, innerH / bounds.height);
const drawW = Math.max(1, Math.round(bounds.width * scale));
const drawH = Math.max(1, Math.round(bounds.height * scale));
const scaled = bilinearScale(cropped, bounds.width, bounds.height, drawW, drawH);

const canvas = Buffer.alloc(TARGET_W * TARGET_H * 4);
const ox = Math.floor((TARGET_W - drawW) / 2);
const oy = Math.floor((TARGET_H - drawH) / 2);
for (let y = 0; y < drawH; y += 1) {
  for (let x = 0; x < drawW; x += 1) {
    const si = (y * drawW + x) * 4;
    if (scaled[si + 3] < 8) continue;
    const di = ((oy + y) * TARGET_W + (ox + x)) * 4;
    canvas[di] = scaled[si];
    canvas[di + 1] = scaled[si + 1];
    canvas[di + 2] = scaled[si + 2];
    canvas[di + 3] = scaled[si + 3];
  }
}

const outPng = encodeRgbaPng(canvas, TARGET_W, TARGET_H);
writeFileSync(OUT, outPng);
const verify = decodePngToRgbaDetailed(outPng);
const vBounds = findVisibleLogoBounds(verify.image.data, TARGET_W, TARGET_H, 10);
console.log(
  JSON.stringify(
    {
      sourcePath,
      source: { w: decoded.image.width, h: decoded.image.height },
      content_bounds: bounds,
      content_aspect: +(bounds.width / bounds.height).toFixed(3),
      out: OUT,
      out_size: { w: TARGET_W, h: TARGET_H },
      out_aspect: +(TARGET_W / TARGET_H).toFixed(3),
      visible_fill: vBounds
        ? {
            w: vBounds.width,
            h: vBounds.height,
            fill_w: +(vBounds.width / TARGET_W).toFixed(3),
            fill_h: +(vBounds.height / TARGET_H).toFixed(3),
          }
        : null,
      bytes: outPng.length,
    },
    null,
    2,
  ),
);
