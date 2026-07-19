/**
 * Refined golden-master measurements → CSS px at A4 content width.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePngToRgbaDetailed } from '../src/domains/income/income-document-logo-png.pure.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PNG = path.join(ROOT, 'New folder/ChatGPT Image Jul 11, 2026, 04_52_58 PM.png');
const decoded = decodePngToRgbaDetailed(readFileSync(PNG));
if (!decoded.ok) {
  console.error(decoded);
  process.exit(1);
}
const { width: W, height: H, data } = decoded.image;

function rgba(x, y) {
  const i = (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}
function isWhite(r, g, b, a, tol = 10) {
  if (a < 180) return true;
  return r >= 255 - tol && g >= 255 - tol && b >= 255 - tol;
}
function isPurple(r, g, b) {
  return b > 150 && r > 50 && r < 150 && g > 30 && g < 130 && b > r + 20 && b > g + 20;
}
function isInk(r, g, b, a) {
  if (a < 40) return false;
  if (isWhite(r, g, b, a, 12)) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 230;
}
function isPanel(r, g, b) {
  // soft lavender/gray panels, not pure white
  return r >= 238 && r <= 252 && g >= 238 && g <= 252 && b >= 245 && b <= 255 && !(r > 252 && g > 252 && b > 252);
}

// Content bbox
let minX = W,
  minY = H,
  maxX = 0,
  maxY = 0;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const [r, g, b, a] = rgba(x, y);
    if (!isWhite(r, g, b, a, 6)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}
const contentW = maxX - minX + 1;
const contentH = maxY - minY + 1;

// Purple bands
const bands = [];
for (let y = 0; y < H; ) {
  let pc = 0;
  for (let x = 0; x < W; x += 2) {
    const [r, g, b] = rgba(x, y);
    if (isPurple(r, g, b)) pc += 1;
  }
  if (pc > W * 0.08) {
    const y0 = y;
    while (y < H) {
      let c = 0;
      for (let x = 0; x < W; x += 2) {
        const [r, g, b] = rgba(x, y);
        if (isPurple(r, g, b)) c += 1;
      }
      if (c <= W * 0.05) break;
      y += 1;
    }
    let x0 = W,
      x1 = 0;
    for (let yy = y0; yy < y; yy += 1) {
      for (let x = 0; x < W; x += 1) {
        const [r, g, b] = rgba(x, yy);
        if (isPurple(r, g, b)) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
      }
    }
    bands.push({ y0, y1: y - 1, h: y - y0, x0, x1, w: x1 - x0 + 1 });
  } else y += 1;
}
const tableHeader = [...bands].sort((a, b) => b.w - a.w)[0];
const numberBar = bands.find((b) => b.y0 < tableHeader.y0 && b.w < tableHeader.w * 0.85);

// Vertical divider: scan for thin gray column in upper half
let divX = Math.floor(W / 2);
let best = -1;
for (let x = Math.floor(W * 0.38); x < Math.floor(W * 0.62); x += 1) {
  let score = 0;
  for (let y = minY; y < numberBar.y1 + 80; y += 1) {
    const [r, g, b] = rgba(x, y);
    if (r > 210 && r < 240 && Math.abs(r - g) < 10 && Math.abs(g - b) < 10) score += 1;
  }
  if (score > best) {
    best = score;
    divX = x;
  }
}

// Row ink density helper for left column — find logo band then gap then company
function rowInkDensity(y, x0, x1) {
  let ink = 0;
  let n = 0;
  for (let x = x0; x <= x1; x += 1) {
    const [r, g, b, a] = rgba(x, y);
    n += 1;
    if (isInk(r, g, b, a)) ink += 1;
  }
  return ink / n;
}

// Logo lockup: from content top until a white gap (~8px) then company name
const leftX0 = minX;
const leftX1 = divX - 6;
let logoY0 = minY;
while (logoY0 < H && rowInkDensity(logoY0, leftX0, leftX1) < 0.01) logoY0 += 1;
let y = logoY0;
let gap = 0;
let logoY1 = logoY0;
while (y < minY + 220) {
  const d = rowInkDensity(y, leftX0, leftX1);
  if (d < 0.008) {
    gap += 1;
    if (gap >= 10) break;
  } else {
    gap = 0;
    logoY1 = y;
  }
  y += 1;
}
// tighten logo x bounds
let lx0 = leftX1,
  lx1 = leftX0;
for (let yy = logoY0; yy <= logoY1; yy += 1) {
  for (let x = leftX0; x <= leftX1; x += 1) {
    const [r, g, b, a] = rgba(x, yy);
    if (isInk(r, g, b, a)) {
      lx0 = Math.min(lx0, x);
      lx1 = Math.max(lx1, x);
    }
  }
}
const logo = { x0: lx0, y0: logoY0, x1: lx1, y1: logoY1, w: lx1 - lx0 + 1, h: logoY1 - logoY0 + 1 };

// Company block: after logo gap until divider bottom / before customer-level
let companyY0 = logoY1 + 1;
while (companyY0 < H && rowInkDensity(companyY0, leftX0, leftX1) < 0.01) companyY0 += 1;
let companyY1 = companyY0;
gap = 0;
for (let yy = companyY0; yy < tableHeader.y0 - 20; yy += 1) {
  const d = rowInkDensity(yy, leftX0, leftX1);
  if (d < 0.006) {
    gap += 1;
    if (gap > 40) break;
  } else {
    gap = 0;
    companyY1 = yy;
  }
}
const company = {
  x0: leftX0,
  y0: companyY0,
  x1: leftX1,
  y1: companyY1,
  w: leftX1 - leftX0 + 1,
  h: companyY1 - companyY0 + 1,
};

// Title ink on right above number bar
const rightX0 = divX + 6;
const rightX1 = maxX;
let ty0 = minY;
while (ty0 < numberBar.y0 && rowInkDensity(ty0, rightX0, rightX1) < 0.01) ty0 += 1;
let ty1 = ty0;
for (let yy = ty0; yy < numberBar.y0; yy += 1) {
  if (rowInkDensity(yy, rightX0, rightX1) >= 0.01) ty1 = yy;
}
let tx0 = rightX1,
  tx1 = rightX0;
for (let yy = ty0; yy <= ty1; yy += 1) {
  for (let x = rightX0; x <= rightX1; x += 1) {
    const [r, g, b, a] = rgba(x, yy);
    if (isInk(r, g, b, a)) {
      tx0 = Math.min(tx0, x);
      tx1 = Math.max(tx1, x);
    }
  }
}
const title = { x0: tx0, y0: ty0, x1: tx1, y1: ty1, w: tx1 - tx0 + 1, h: ty1 - ty0 + 1 };
// Cap-height → font-size estimate (Hebrew bold ~ ink_h / 0.78)
const titleFontEstimate = Math.round(title.h / 0.78);

// Meta rows: between number bar and customer card
const metaY0 = numberBar.y1 + 1;
// Customer card: find panel flood on right
let custY0 = null,
  custY1 = null,
  custX0 = null,
  custX1 = null;
for (let y = metaY0; y < tableHeader.y0; y += 1) {
  for (let x = rightX0; x <= rightX1; x += 1) {
    const [r, g, b] = rgba(x, y);
    if (isPanel(r, g, b)) {
      if (custY0 == null) {
        custY0 = y;
        custX0 = x;
        custX1 = x;
      }
      custY1 = y;
      custX0 = Math.min(custX0, x);
      custX1 = Math.max(custX1, x);
    }
  }
}
const customer =
  custY0 != null
    ? { x0: custX0, y0: custY0, x1: custX1, y1: custY1, w: custX1 - custX0 + 1, h: custY1 - custY0 + 1 }
    : null;

// Meta spacing: average gap between ink rows in meta zone
const metaZoneY1 = customer ? customer.y0 - 1 : tableHeader.y0 - 1;
const metaInkRows = [];
for (let yy = metaY0; yy <= metaZoneY1; yy += 1) {
  if (rowInkDensity(yy, rightX0, rightX1) > 0.02) metaInkRows.push(yy);
}
let metaRowGaps = [];
if (metaInkRows.length) {
  let runStart = metaInkRows[0];
  let prev = metaInkRows[0];
  const runs = [];
  for (let i = 1; i < metaInkRows.length; i += 1) {
    if (metaInkRows[i] === prev + 1) {
      prev = metaInkRows[i];
    } else {
      runs.push({ y0: runStart, y1: prev, h: prev - runStart + 1 });
      runStart = metaInkRows[i];
      prev = metaInkRows[i];
    }
  }
  runs.push({ y0: runStart, y1: prev, h: prev - runStart + 1 });
  for (let i = 1; i < runs.length; i += 1) {
    metaRowGaps.push(runs[i].y0 - runs[i - 1].y1 - 1);
  }
}

// Table row height via separator
function tableRowH() {
  const yStart = tableHeader.y1 + 1;
  for (let y = yStart + 30; y < yStart + 180; y += 1) {
    let hits = 0;
    const samples = Math.floor((tableHeader.x1 - tableHeader.x0) / 4);
    for (let x = tableHeader.x0; x <= tableHeader.x1; x += 4) {
      const [r, g, b] = rgba(x, y);
      if (r > 220 && r < 248 && g > 220 && b > 230) hits += 1;
    }
    if (hits > samples * 0.35) return y - yStart;
  }
  return null;
}
const rowH = tableRowH();

// Lower cards: find two side-by-side panels just under table, limited height
function findPanelBelow(x0, x1, y0, yMax) {
  let py0 = null,
    py1 = null,
    px0 = x1,
    px1 = x0;
  for (let y = y0; y < yMax; y += 1) {
    let rowHas = false;
    for (let x = x0; x <= x1; x += 2) {
      const [r, g, b] = rgba(x, y);
      if (isPanel(r, g, b)) {
        rowHas = true;
        px0 = Math.min(px0, x);
        px1 = Math.max(px1, x);
      }
    }
    if (rowHas) {
      if (py0 == null) py0 = y;
      py1 = y;
    } else if (py0 != null && y - py1 > 15) {
      // end of first panel block
      break;
    }
  }
  if (py0 == null) return null;
  return { x0: px0, y0: py0, x1: px1, y1: py1, w: px1 - px0 + 1, h: py1 - py0 + 1 };
}

const mid = Math.floor((minX + maxX) / 2);
const notesOrTotalsA = findPanelBelow(minX, mid - 4, tableHeader.y1 + 4, tableHeader.y1 + 280);
const notesOrTotalsB = findPanelBelow(mid + 4, maxX, tableHeader.y1 + 4, tableHeader.y1 + 280);

// Payment area: three cards — scan for panel rows below totals
const payY0 = Math.max(notesOrTotalsA?.y1 || 0, notesOrTotalsB?.y1 || 0) + 8;
const paymentPanel = findPanelBelow(minX, maxX, payY0, maxY - 40);

// Footer: remaining bottom ink band
let footerY0 = maxY;
for (let y = maxY; y > maxY - 120; y -= 1) {
  if (rowInkDensity(y, minX, maxX) > 0.01) footerY0 = y;
  else if (footerY0 < maxY && maxY - y > 8) break;
}
// find start of footer
let fy0 = footerY0;
for (let y = footerY0; y > footerY0 - 80; y -= 1) {
  if (rowInkDensity(y, minX, maxX) > 0.008) fy0 = y;
  else break;
}
const footer = { y0: fy0, y1: maxY, h: maxY - fy0 + 1 };

// Number bar radius estimate: sample corner curvature — use geometric: measure inset of purple at top of bar
function estimateRadius(band) {
  const midY = band.y0 + Math.floor(band.h / 2);
  let leftEdge = band.x0;
  while (leftEdge < band.x1) {
    const [r, g, b] = rgba(leftEdge, midY);
    if (isPurple(r, g, b)) break;
    leftEdge += 1;
  }
  // at top row, how far inset is purple start
  let topInset = 0;
  for (let i = 0; i < band.h; i += 1) {
    const [r, g, b] = rgba(leftEdge, band.y0 + i);
    if (isPurple(r, g, b)) {
      topInset = i;
      break;
    }
  }
  // rough radius ≈ topInset * 2 or from corner
  let rEst = 0;
  for (let dy = 0; dy < Math.min(20, band.h); dy += 1) {
    let dx = 0;
    while (dx < 30) {
      const [r, g, b] = rgba(leftEdge + dx, band.y0 + dy);
      if (isPurple(r, g, b)) break;
      dx += 1;
    }
    if (dx > 0) rEst = Math.max(rEst, dx + dy);
  }
  return Math.max(6, Math.min(16, Math.round(rEst * 0.55) || 8));
}

const radiusImg = estimateRadius(numberBar);

// CSS mapping: content width → A4 printable content
// Use @page margin 12mm → content 186mm = 703px @96dpi
const CSS_W = 703;
const s = CSS_W / contentW;
const px = (v) => Math.round(v * s);

const css = {
  // PAGE
  a4_printable_width_px: 794, // 210mm
  a4_printable_height_px: 1123, // 297mm
  content_width_px: CSS_W,
  content_height_px: px(contentH),
  margin_left_px: 45, // 12mm @96dpi
  margin_right_px: 45,
  margin_top_px: 38, // 10mm
  margin_bottom_px: 45, // 12mm
  // from image scaled — document padding inside content = 0 if margins are @page
  page_padding_px: 0,

  // TOP
  branding_col_width_px: px(divX - minX),
  doc_col_width_px: px(maxX - divX),
  logo_block_width_px: px(logo.w),
  logo_block_height_px: px(logo.h),
  logo_visible_width_px: px(logo.w),
  logo_visible_height_px: px(logo.h),
  company_block_width_px: px(company.w),
  company_block_height_px: px(company.h),
  document_title_font_size_px: px(titleFontEstimate),
  document_title_ink_height_px: px(title.h),
  document_title_line_height: 1.1,
  purple_number_width_px: px(numberBar.w),
  purple_number_height_px: px(numberBar.h),
  purple_number_radius_px: px(radiusImg),
  gap_title_to_number_px: px(numberBar.y0 - title.y1 - 1),
  metadata_row_gap_px: metaRowGaps.length
    ? px(Math.round(metaRowGaps.reduce((a, b) => a + b, 0) / metaRowGaps.length))
    : 8,
  customer_card_width_px: customer ? px(customer.w) : null,
  customer_card_height_px: customer ? px(customer.h) : null,
  table_top_margin_px: customer ? px(tableHeader.y0 - customer.y1 - 1) : null,
  table_header_height_px: px(tableHeader.h),
  table_row_height_px: rowH != null ? px(rowH) : null,
  totals_card_height_px: notesOrTotalsA ? px(notesOrTotalsA.h) : null,
  notes_card_height_px: notesOrTotalsB ? px(notesOrTotalsB.h) : null,
  payment_cards_height_px: paymentPanel ? px(paymentPanel.h) : null,
  footer_height_px: px(footer.h),
  primary_purple: '#5E42D3',
};

const report = {
  image: { W, H },
  content: { minX, minY, maxX, maxY, contentW, contentH },
  divider_x: divX,
  logo_image: logo,
  company_image: company,
  title_image: { ...title, font_estimate: titleFontEstimate },
  number_bar_image: numberBar,
  number_bar_radius_image: radiusImg,
  meta_row_gaps_image: metaRowGaps,
  customer_image: customer,
  table_header_image: tableHeader,
  table_row_height_image: rowH,
  panel_a_image: notesOrTotalsA,
  panel_b_image: notesOrTotalsB,
  payment_image: paymentPanel,
  footer_image: footer,
  scale: s,
  css_px: css,
};

writeFileSync(
  path.join(ROOT, 'apps/api/scripts/golden-master-measurements.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
