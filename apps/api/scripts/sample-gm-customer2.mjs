import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgbaDetailed } from '../src/domains/income/income-document-logo-png.pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const d = decodePngToRgbaDetailed(
  readFileSync(path.join(ROOT, 'New folder/ChatGPT Image Jul 11, 2026, 04_52_58 PM.png')),
);
const { width: W, data } = d.image;
const at = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
function isCust(r, g, b) {
  return r >= 240 && r <= 252 && g >= 240 && g <= 252 && b >= 248 && b <= 255 && b - Math.min(r, g) >= 3;
}
const dens = [];
for (let y = 200; y < 720; y++) {
  let n = 0;
  for (let x = 520; x < 1020; x++) if (isCust(...at(x, y))) n++;
  dens.push({ y, n });
}
// find longest run with n > 80
let best = null;
let i = 0;
while (i < dens.length) {
  if (dens[i].n > 80) {
    let j = i;
    while (j < dens.length && dens[j].n > 80) j++;
    const run = { y0: dens[i].y, y1: dens[j - 1].y, h: dens[j - 1].y - dens[i].y + 1 };
    if (!best || run.h > best.h) best = run;
    i = j;
  } else i++;
}
// x bounds in that run
let x0 = W,
  x1 = 0;
for (let y = best.y0; y <= best.y1; y++)
  for (let x = 520; x < 1020; x++)
    if (isCust(...at(x, y))) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
const s = 703 / 997;
const px = (v) => Math.round(v * s);
console.log(
  JSON.stringify(
    {
      best,
      x: { x0, x1, w: x1 - x0 + 1 },
      css: { w: px(x1 - x0 + 1), h: px(best.h), topGapFromNumberBar: px(best.y0 - 181), tableGap: px(713 - best.y1) },
      // peaks
      top20: dens.filter((d) => d.n > 80).slice(0, 5),
      mid: dens.filter((d) => d.y >= 500 && d.y <= 510),
    },
    null,
    2,
  ),
);
