import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgbaDetailed } from '../src/domains/income/income-document-logo-png.pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PNG = path.join(ROOT, 'New folder/ChatGPT Image Jul 11, 2026, 04_52_58 PM.png');
const { image } = (() => {
  const d = decodePngToRgbaDetailed(readFileSync(PNG));
  if (!d.ok) throw new Error(JSON.stringify(d));
  return d;
})();
const { width: W, height: H, data } = image;
const rgba = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};
const isWhite = (r, g, b, a, tol = 8) => a < 180 || (r >= 255 - tol && g >= 255 - tol && b >= 255 - tol);
const isPurple = (r, g, b) => b > 150 && r < 150 && g < 130 && b > r + 30 && b > g + 30;
const isDark = (r, g, b, a) => {
  if (a < 40 || isWhite(r, g, b, a, 12) || isPurple(r, g, b)) return false;
  return 0.299 * r + 0.587 * g + 0.114 * b < 90;
};
const isLavenderPanel = (r, g, b) => {
  // #F1F4FF family: blue channel clearly higher, not gray
  return r >= 235 && r <= 250 && g >= 238 && g <= 252 && b >= 248 && b <= 255 && b - r >= 4 && b - g >= 2;
};

let minX = W,
  minY = H,
  maxX = 0,
  maxY = 0;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = rgba(x, y);
    if (!isWhite(r, g, b, a, 5)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
const contentW = maxX - minX + 1;

// purple bands
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

// divider
let divX = Math.floor(W / 2),
  best = -1;
for (let x = Math.floor(W * 0.4); x < Math.floor(W * 0.6); x++) {
  let s = 0;
  for (let y = minY; y < numberBar.y1 + 60; y++) {
    const [r, g, b] = rgba(x, y);
    if (r > 210 && r < 238 && Math.abs(r - g) < 8) s++;
  }
  if (s > best) {
    best = s;
    divX = x;
  }
}

const left0 = minX,
  left1 = divX - 8,
  right0 = divX + 8,
  right1 = maxX;
const rowDark = (y, a, b) => {
  let n = 0,
    t = 0;
  for (let x = a; x <= b; x++) {
    t++;
    if (isDark(...rgba(x, y))) n++;
  }
  return n / t;
};
const rowAnyInk = (y, a, b) => {
  let n = 0,
    t = 0;
  for (let x = a; x <= b; x++) {
    t++;
    const [r, g, b2, al] = rgba(x, y);
    if (!isWhite(r, g, b2, al, 12) && !isPurple(r, g, b2)) n++;
  }
  return n / t;
};

// logo lockup (any non-white non-purple-only in left top)
let ly0 = minY;
while (ly0 < 200 && rowAnyInk(ly0, left0, left1) < 0.01) ly0++;
let ly1 = ly0,
  gap = 0;
for (let y = ly0; y < 200; y++) {
  if (rowAnyInk(y, left0, left1) < 0.01) {
    gap++;
    if (gap >= 8) break;
  } else {
    gap = 0;
    ly1 = y;
  }
}
let lx0 = left1,
  lx1 = left0;
for (let y = ly0; y <= ly1; y++)
  for (let x = left0; x <= left1; x++) {
    const [r, g, b, a] = rgba(x, y);
    if (!isWhite(r, g, b, a, 12)) {
      lx0 = Math.min(lx0, x);
      lx1 = Math.max(lx1, x);
    }
  }
const logo = { w: lx1 - lx0 + 1, h: ly1 - ly0 + 1, x0: lx0, y0: ly0, x1: lx1, y1: ly1 };

// title = dark text only above number bar
let ty0 = minY;
while (ty0 < numberBar.y0 && rowDark(ty0, right0, right1) < 0.005) ty0++;
let ty1 = ty0;
for (let y = ty0; y < numberBar.y0 - 2; y++) if (rowDark(y, right0, right1) >= 0.005) ty1 = y;
let tx0 = right1,
  tx1 = right0;
for (let y = ty0; y <= ty1; y++)
  for (let x = right0; x <= right1; x++)
    if (isDark(...rgba(x, y))) {
      tx0 = Math.min(tx0, x);
      tx1 = Math.max(tx1, x);
    }
const titleInkH = ty1 - ty0 + 1;
const titleFont = Math.round(titleInkH / 0.72); // bold Hebrew cap-ish

// customer: lavender panel flood fill from a seed
let seed = null;
for (let y = numberBar.y1 + 20; y < tableHeader.y0 && !seed; y++)
  for (let x = right0; x <= right1 && !seed; x++) {
    const [r, g, b] = rgba(x, y);
    if (isLavenderPanel(r, g, b)) seed = { x, y };
  }
let customer = null;
if (seed) {
  const seen = new Uint8Array(W * H);
  const stack = [seed.x, seed.y];
  let x0 = seed.x,
    x1 = seed.x,
    y0 = seed.y,
    y1 = seed.y;
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const i = y * W + x;
    if (seen[i]) continue;
    const [r, g, b] = rgba(x, y);
    if (!isLavenderPanel(r, g, b)) continue;
    seen[i] = 1;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    if (x + 1 < W) stack.push(x + 1, y);
    if (x > 0) stack.push(x - 1, y);
    if (y + 1 < H) stack.push(x, y + 1);
    if (y > 0) stack.push(x, y - 1);
  }
  customer = { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// meta gaps: dark rows between numberBar and customer
const metaEnd = customer ? customer.y0 - 1 : tableHeader.y0;
const runs = [];
let rs = null;
for (let y = numberBar.y1 + 1; y <= metaEnd; y++) {
  const d = rowDark(y, right0, right1) > 0.01;
  if (d) {
    if (rs == null) rs = y;
  } else if (rs != null) {
    runs.push({ y0: rs, y1: y - 1, h: y - rs });
    rs = null;
  }
}
if (rs != null) runs.push({ y0: rs, y1: metaEnd, h: metaEnd - rs + 1 });
const metaGaps = [];
for (let i = 1; i < runs.length; i++) metaGaps.push(runs[i].y0 - runs[i - 1].y1 - 1);

// company block height
let cy0 = ly1 + 1;
while (cy0 < tableHeader.y0 && rowAnyInk(cy0, left0, left1) < 0.01) cy0++;
let cy1 = cy0;
gap = 0;
for (let y = cy0; y < (customer ? customer.y1 : tableHeader.y0); y++) {
  if (rowAnyInk(y, left0, left1) < 0.008) {
    gap++;
    if (gap > 25) break;
  } else {
    gap = 0;
    cy1 = y;
  }
}
const company = { w: left1 - left0 + 1, h: cy1 - cy0 + 1, y0: cy0, y1: cy1 };

// table row
let rowH = null;
for (let y = tableHeader.y1 + 40; y < tableHeader.y1 + 160; y++) {
  let hits = 0,
    n = 0;
  for (let x = tableHeader.x0; x <= tableHeader.x1; x += 3) {
    n++;
    const [r, g, b] = rgba(x, y);
    if (r > 220 && r < 248 && g > 220 && b > 230) hits++;
  }
  if (hits > n * 0.4) {
    rowH = y - (tableHeader.y1 + 1);
    break;
  }
}

// lower panels with lavender OR light gray #F8F8FD
const isSoftPanel = (r, g, b) =>
  isLavenderPanel(r, g, b) ||
  (r >= 244 && r <= 252 && g >= 244 && g <= 252 && b >= 248 && b <= 255 && !(r > 252 && g > 252 && b > 252));

function panelBox(xA, xB, yA, yB) {
  let found = false,
    x0 = xB,
    x1 = xA,
    y0 = yB,
    y1 = yA;
  for (let y = yA; y <= yB; y++)
    for (let x = xA; x <= xB; x += 1) {
      const [r, g, b] = rgba(x, y);
      if (isSoftPanel(r, g, b)) {
        found = true;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  return found ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}

// First soft panel band under table — split left/right at mid for equal cards
const mid = Math.floor((minX + maxX) / 2);
// find first panel y
let pY = null;
for (let y = tableHeader.y1 + 2; y < tableHeader.y1 + 40; y++) {
  for (let x = minX; x <= maxX; x += 4) {
    if (isSoftPanel(...rgba(x, y))) {
      pY = y;
      break;
    }
  }
  if (pY != null) break;
}
// height: until white gap
let pY1 = pY;
if (pY != null) {
  let white = 0;
  for (let y = pY; y < pY + 350; y++) {
    let panel = 0,
      t = 0;
    for (let x = minX; x <= maxX; x += 4) {
      t++;
      if (isSoftPanel(...rgba(x, y))) panel++;
    }
    if (panel / t < 0.05) {
      white++;
      if (white > 6) break;
    } else {
      white = 0;
      pY1 = y;
    }
  }
}
const totals = pY != null ? panelBox(minX, mid - 6, pY, pY1) : null;
const notes = pY != null ? panelBox(mid + 6, maxX, pY, pY1) : null;

// payment: next panel band
let payY = null;
const searchPay = (totals?.y1 || pY1 || tableHeader.y1) + 10;
for (let y = searchPay; y < searchPay + 80; y++) {
  for (let x = minX; x <= maxX; x += 4) {
    if (isSoftPanel(...rgba(x, y))) {
      payY = y;
      break;
    }
  }
  if (payY != null) break;
}
let payY1 = payY;
if (payY != null) {
  let white = 0;
  for (let y = payY; y < payY + 450; y++) {
    let panel = 0,
      t = 0;
    for (let x = minX; x <= maxX; x += 4) {
      t++;
      if (isSoftPanel(...rgba(x, y))) panel++;
    }
    if (panel / t < 0.04) {
      white++;
      if (white > 8) break;
    } else {
      white = 0;
      payY1 = y;
    }
  }
}
const payment = payY != null ? { y0: payY, y1: payY1, h: payY1 - payY + 1 } : null;

const CSS_W = 703;
const s = CSS_W / contentW;
const px = (v) => Math.round(v * s);

const css = {
  a4_printable_width_px: 794,
  a4_printable_height_px: 1123,
  content_width_px: 703,
  left_margin_px: 45,
  right_margin_px: 45,
  top_margin_px: 38,
  bottom_margin_px: 45,
  logo_block_width_px: px(logo.w),
  logo_block_height_px: px(logo.h),
  logo_visible_width_px: px(logo.w),
  logo_visible_height_px: px(logo.h),
  company_block_width_px: px(company.w),
  company_block_height_px: px(company.h),
  document_title_font_size_px: px(titleFont),
  document_title_line_height: 1.1,
  purple_document_number_width_px: px(numberBar.w),
  purple_document_number_height_px: px(numberBar.h),
  purple_document_number_radius_px: 8, // measured corner estimator under-read; GM visual corner ≈8 image→ use 8 css after scale check
  purple_document_number_radius_from_image_scaled_px: px(8),
  gap_title_to_number_px: px(Math.max(0, numberBar.y0 - ty1 - 1)),
  metadata_spacing_px: metaGaps.length ? px(Math.round(metaGaps.reduce((a, b) => a + b, 0) / metaGaps.length)) : px(10),
  customer_card_width_px: customer ? px(customer.w) : null,
  customer_card_height_px: customer ? px(customer.h) : null,
  table_top_margin_px: customer ? px(Math.max(0, tableHeader.y0 - customer.y1 - 1)) : null,
  table_header_height_px: px(tableHeader.h),
  table_row_height_px: rowH != null ? px(rowH) : null,
  totals_card_height_px: totals ? px(totals.h) : null,
  notes_card_height_px: notes ? px(notes.h) : null,
  payment_cards_height_px: payment ? px(payment.h) : null,
  footer_height_px: px(57),
  branding_col_width_px: px(divX - minX),
  doc_col_width_px: px(maxX - divX),
  primary: '#5E42D3',
};

const out = {
  image: { W, H, contentW, contentH: maxY - minY + 1 },
  logo,
  title: { ty0, ty1, titleInkH, titleFont, gap: numberBar.y0 - ty1 - 1 },
  numberBar,
  company,
  customer,
  metaGaps,
  metaRuns: runs,
  tableHeader,
  rowH,
  totals,
  notes,
  payment,
  scale: s,
  css,
};
writeFileSync(path.join(ROOT, 'apps/api/scripts/golden-master-measurements.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
