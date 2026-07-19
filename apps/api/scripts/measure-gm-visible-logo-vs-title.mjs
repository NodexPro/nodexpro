/**
 * Measure VISIBLE painted artwork (not containers) on the golden master.
 * Logo lockup vs document title ink bounding boxes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgbaDetailed } from '../src/domains/income/income-document-logo-png.pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PNG = path.join(ROOT, 'New folder/ChatGPT Image Jul 11, 2026, 04_52_58 PM.png');
const d = decodePngToRgbaDetailed(readFileSync(PNG));
if (!d.ok) {
  console.error(d);
  process.exit(1);
}
const { width: W, height: H, data } = d.image;

function rgba(x, y) {
  const i = (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
function isWhite(r, g, b, a, tol = 12) {
  if (a < 40) return true;
  return r >= 255 - tol && g >= 255 - tol && b >= 255 - tol;
}
function isPurple(r, g, b) {
  return b > 150 && r < 150 && g < 130 && b > r + 30 && b > g + 30;
}
function isPainted(r, g, b, a) {
  if (a < 40) return false;
  if (isWhite(r, g, b, a, 14)) return false;
  return true;
}
function isDarkInk(r, g, b, a) {
  if (a < 40 || isWhite(r, g, b, a, 14) || isPurple(r, g, b)) return false;
  return 0.299 * r + 0.587 * g + 0.114 * b < 100;
}

// content + purple number bar
let minX = W,
  minY = H,
  maxX = 0,
  maxY = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = rgba(x, y);
    if (!isWhite(r, g, b, a, 6)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

const bands = [];
for (let y = 0; y < H; ) {
  let pc = 0;
  for (let x = 0; x < W; x += 2) if (isPurple(...rgba(x, y))) pc++;
  if (pc > W * 0.08) {
    const y0 = y;
    while (y < H) {
      let c = 0;
      for (let x = 0; x < W; x += 2) if (isPurple(...rgba(x, y))) c++;
      if (c <= W * 0.05) break;
      y++;
    }
    let x0 = W,
      x1 = 0;
    for (let yy = y0; yy < y; yy++)
      for (let x = 0; x < W; x++)
        if (isPurple(...rgba(x, yy))) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
    bands.push({ y0, y1: y - 1, h: y - y0, x0, x1, w: x1 - x0 + 1 });
  } else y++;
}
const tableHeader = [...bands].sort((a, b) => b.w - a.w)[0];
const numberBar = bands.find((b) => b.y0 < tableHeader.y0);

// vertical divider
let divX = Math.floor(W / 2),
  best = -1;
for (let x = Math.floor(W * 0.4); x < Math.floor(W * 0.6); x++) {
  let s = 0;
  for (let y = minY; y < numberBar.y1 + 40; y++) {
    const [r, g, b] = rgba(x, y);
    if (r > 210 && r < 238 && Math.abs(r - g) < 8) s++;
  }
  if (s > best) {
    best = s;
    divX = x;
  }
}

const left0 = minX;
const left1 = divX - 8;
const right0 = divX + 8;
const right1 = maxX;

function rowPaintDensity(y, xA, xB, pred) {
  let n = 0,
    t = 0;
  for (let x = xA; x <= xB; x++) {
    t++;
    if (pred(...rgba(x, y))) n++;
  }
  return n / t;
}

// LOGO VISIBLE ARTWORK: painted pixels in left column from top until white gap before company name
let ly0 = minY;
while (ly0 < 220 && rowPaintDensity(ly0, left0, left1, isPainted) < 0.01) ly0++;
let ly1 = ly0;
let gap = 0;
for (let y = ly0; y < 220; y++) {
  if (rowPaintDensity(y, left0, left1, isPainted) < 0.012) {
    gap++;
    if (gap >= 8) break;
  } else {
    gap = 0;
    ly1 = y;
  }
}
let lx0 = left1,
  lx1 = left0;
let paintedCount = 0;
for (let y = ly0; y <= ly1; y++)
  for (let x = left0; x <= left1; x++) {
    if (isPainted(...rgba(x, y))) {
      paintedCount++;
      lx0 = Math.min(lx0, x);
      lx1 = Math.max(lx1, x);
    }
  }
const logoArt = {
  x0: lx0,
  y0: ly0,
  x1: lx1,
  y1: ly1,
  width: lx1 - lx0 + 1,
  height: ly1 - ly0 + 1,
  painted_pixels: paintedCount,
};

// TITLE VISIBLE INK: dark text only above number bar (exclude purple)
let ty0 = minY;
while (ty0 < numberBar.y0 && rowPaintDensity(ty0, right0, right1, isDarkInk) < 0.005) ty0++;
let ty1 = ty0;
for (let y = ty0; y < numberBar.y0 - 2; y++) {
  if (rowPaintDensity(y, right0, right1, isDarkInk) >= 0.005) ty1 = y;
}
let tx0 = right1,
  tx1 = right0;
let titlePainted = 0;
for (let y = ty0; y <= ty1; y++)
  for (let x = right0; x <= right1; x++) {
    if (isDarkInk(...rgba(x, y))) {
      titlePainted++;
      tx0 = Math.min(tx0, x);
      tx1 = Math.max(tx1, x);
    }
  }
const titleArt = {
  x0: tx0,
  y0: ty0,
  x1: tx1,
  y1: ty1,
  width: tx1 - tx0 + 1,
  height: ty1 - ty0 + 1,
  painted_pixels: titlePainted,
};

const contentW = maxX - minX + 1;
const CSS_W = 703;
const s = CSS_W / contentW;
const px = (v) => Math.round(v * s);

const report = {
  image: { W, H, contentW },
  scale_to_a4_content: s,
  logo_visible_artwork_image_px: logoArt,
  title_visible_artwork_image_px: titleArt,
  logo_visible_artwork_css_px: {
    width: px(logoArt.width),
    height: px(logoArt.height),
    area: px(logoArt.width) * px(logoArt.height),
  },
  title_visible_artwork_css_px: {
    width: px(titleArt.width),
    height: px(titleArt.height),
    area: px(titleArt.width) * px(titleArt.height),
  },
  comparison: {
    logo_vs_title_width_ratio: +(logoArt.width / titleArt.width).toFixed(3),
    logo_vs_title_height_ratio: +(logoArt.height / titleArt.height).toFixed(3),
    logo_vs_title_bbox_area_ratio: +((logoArt.width * logoArt.height) / (titleArt.width * titleArt.height)).toFixed(3),
    logo_taller_than_title: logoArt.height > titleArt.height,
    logo_wider_than_title: logoArt.width > titleArt.width,
  },
  branding_col_width_css: px(divX - minX),
};

writeFileSync(path.join(ROOT, 'apps/api/scripts/gm-visible-logo-vs-title.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
