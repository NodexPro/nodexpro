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
function soft(r, g, b) {
  return r > 230 && g > 230 && b > 235 && !(r > 252 && g > 252 && b > 252);
}
let y0 = null,
  y1 = null,
  x0 = 9999,
  x1 = 0;
for (let y = 200; y < 710; y++) {
  let hit = false;
  for (let x = 520; x < 1020; x++) {
    const [r, g, b] = at(x, y);
    if (soft(r, g, b) && b >= r) {
      hit = true;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
  }
  if (hit) {
    if (y0 == null) y0 = y;
    y1 = y;
  }
}
console.log(
  JSON.stringify(
    {
      softRegion: { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 },
      samples: [250, 400, 550].flatMap((y) =>
        [600, 800, 980].map((x) => ({ x, y, rgb: at(x, y) })),
      ),
      numberBar: at(800, 150),
      tableHeader: at(500, 730),
      // lower cards sample
      lowerL: at(200, 850),
      lowerR: at(800, 850),
      pay: at(500, 1150),
    },
    null,
    2,
  ),
);
