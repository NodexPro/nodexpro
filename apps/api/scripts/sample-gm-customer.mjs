import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgbaDetailed } from '../src/domains/income/income-document-logo-png.pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const d = decodePngToRgbaDetailed(
  readFileSync(path.join(ROOT, 'New folder/ChatGPT Image Jul 11, 2026, 04_52_58 PM.png')),
);
const { width: W, height: H, data } = d.image;
const at = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
// Customer panel: lavender like 247,246,254
function isCust(r, g, b) {
  return r >= 240 && r <= 252 && g >= 240 && g <= 252 && b >= 248 && b <= 255 && b - Math.min(r, g) >= 3;
}

let x0 = W,
  x1 = 0,
  y0 = H,
  y1 = 0,
  count = 0;
for (let y = 180; y < 720; y++) {
  for (let x = 500; x < 1030; x++) {
    const [r, g, b] = at(x, y);
    if (isCust(r, g, b)) {
      count++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
}
const contentW = 997;
const s = 703 / contentW;
const px = (v) => Math.round(v * s);
console.log(
  JSON.stringify(
    {
      count,
      bbox: { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 },
      css: { w: px(x1 - x0 + 1), h: px(y1 - y0 + 1) },
      // row density of cust color
      dens: [300, 400, 500, 550, 600, 650].map((y) => {
        let n = 0;
        for (let x = 500; x < 1030; x++) if (isCust(...at(x, y))) n++;
        return { y, n };
      }),
      // lower cards
      lower: (() => {
        let lx0 = W,
          lx1 = 0,
          ly0 = H,
          ly1 = 0,
          c = 0;
        for (let y = 760; y < 1050; y++)
          for (let x = 20; x < 1030; x++) {
            const [r, g, b] = at(x, y);
            if (isCust(r, g, b) || (r >= 244 && g >= 244 && b >= 248 && r <= 252)) {
              c++;
              lx0 = Math.min(lx0, x);
              lx1 = Math.max(lx1, x);
              ly0 = Math.min(ly0, y);
              ly1 = Math.max(ly1, y);
            }
          }
        return { c, w: lx1 - lx0 + 1, h: ly1 - ly0 + 1, cssH: px(ly1 - ly0 + 1) };
      })(),
      pay: (() => {
        let ly0 = H,
          ly1 = 0,
          c = 0;
        for (let y = 1050; y < 1450; y++)
          for (let x = 20; x < 1030; x += 2) {
            const [r, g, b] = at(x, y);
            if (r >= 235 && r <= 248 && g >= 232 && b >= 245) {
              c++;
              ly0 = Math.min(ly0, y);
              ly1 = Math.max(ly1, y);
            }
          }
        return { c, h: ly1 - ly0 + 1, cssH: px(ly1 - ly0 + 1), y0: ly0, y1: ly1 };
      })(),
    },
    null,
    2,
  ),
);
