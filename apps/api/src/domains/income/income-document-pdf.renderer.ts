/**
 * INC-6 — Server-side PDF renderer (pdf-lib + Noto Sans Hebrew). No browser dependency.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, rgb, type RGB } from 'pdf-lib';
import type { IncomeDocumentRenderSnapshot } from './income-document-render-snapshot.builders.js';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function resolveNotoWoffPaths(): { hebrew: string; latin: string } {
  const base = path.join(API_ROOT, 'node_modules/@fontsource/noto-sans-hebrew/files');
  const hebrew = path.join(base, 'noto-sans-hebrew-hebrew-400-normal.woff');
  const latin = path.join(base, 'noto-sans-hebrew-latin-400-normal.woff');
  if (!fs.existsSync(hebrew) || !fs.existsSync(latin)) {
    throw new Error('PDF fonts missing (install @fontsource/noto-sans-hebrew)');
  }
  return { hebrew, latin };
}

function isHebrewScriptCodePoint(cp: number): boolean {
  return (cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f);
}

function fontForCodePoint(cp: number, he: PDFFont, lat: PDFFont): PDFFont {
  return isHebrewScriptCodePoint(cp) ? he : lat;
}

function widthOfMixedText(text: string, size: number, he: PDFFont, lat: PDFFont): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    w += fontForCodePoint(cp, he, lat).widthOfTextAtSize(ch, size);
  }
  return w;
}

function splitFontRuns(text: string, he: PDFFont, lat: PDFFont): { text: string; font: PDFFont }[] {
  const runs: { text: string; font: PDFFont }[] = [];
  let cur = '';
  let curF: PDFFont | null = null;
  for (const ch of text) {
    const f = fontForCodePoint(ch.codePointAt(0)!, he, lat);
    if (curF === null) {
      cur = ch;
      curF = f;
    } else if (f === curF) {
      cur += ch;
    } else {
      runs.push({ text: cur, font: curF });
      cur = ch;
      curF = f;
    }
  }
  if (cur && curF) runs.push({ text: cur, font: curF });
  return runs;
}

export async function renderIncomeDocumentPdfBuffer(
  snapshot: IncomeDocumentRenderSnapshot,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const { hebrew: hePath, latin: latPath } = resolveNotoWoffPaths();
  const [fontHe, fontLat] = await Promise.all([
    pdfDoc.embedFont(fs.readFileSync(hePath), { subset: false }),
    pdfDoc.embedFont(fs.readFileSync(latPath), { subset: false }),
  ]);

  const rtl = snapshot.template.rtl;
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 48;
  const contentW = pageWidth - 2 * margin;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const lh = (s: number) => s * 1.35;

  const newPageIfNeeded = (need: number) => {
    if (y >= need) return;
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const drawLine = (text: string, size: number, color: RGB, bold = false) => {
    const runs = splitFontRuns(text, fontHe, fontLat);
    if (rtl) {
      let x = pageWidth - margin;
      for (let i = runs.length - 1; i >= 0; i--) {
        const run = runs[i]!;
        const w = run.font.widthOfTextAtSize(run.text, size);
        x -= w;
        page.drawText(run.text, { x, y: y - size, size, font: run.font, color });
      }
    } else {
      let x = margin;
      for (const run of runs) {
        page.drawText(run.text, { x, y: y - size, size, font: run.font, color });
        x += run.font.widthOfTextAtSize(run.text, size);
      }
    }
    y -= lh(size);
  };

  const drawBlock = (lines: string[], size: number, color: RGB) => {
    for (const line of lines) {
      newPageIfNeeded(margin + lh(size) + 8);
      drawLine(line, size, color);
    }
  };

  const titleColor = rgb(0.05, 0.09, 0.16);
  const muted = rgb(0.35, 0.4, 0.45);
  const accent = rgb(0.12, 0.35, 0.55);

  drawLine(snapshot.document.document_type_label, 20, accent);
  y -= 4;
  drawLine(
    rtl
      ? `מס׳ ${snapshot.document.document_number} · ${snapshot.document.issue_date}`
      : `No. ${snapshot.document.document_number} · ${snapshot.document.issue_date}`,
    11,
    muted,
  );
  y -= 12;

  const issuerParty = snapshot.issuer_block ?? snapshot.issuer;
  const recipientParty = snapshot.recipient_block ?? snapshot.customer;

  const issuerLines = [
    issuerParty.legal_name,
    issuerParty.business_type_label ?? '',
    issuerParty.tax_id ? (rtl ? `ע.מ/ח.פ: ${issuerParty.tax_id}` : `Tax ID: ${issuerParty.tax_id}`) : '',
    issuerParty.phone ?? '',
    ...issuerParty.address_lines,
  ].filter(Boolean);
  const customerLines = [
    recipientParty.display_name,
    recipientParty.tax_id ? (rtl ? `מזהה: ${recipientParty.tax_id}` : `ID: ${recipientParty.tax_id}`) : '',
    recipientParty.phone ?? '',
    recipientParty.email ?? '',
    ...recipientParty.address_lines,
  ].filter(Boolean);

  const headerY = y;
  const colW = contentW / 2 - 8;
  const leftX = margin;
  const rightX = margin + colW + 16;

  const drawPartyColumn = (x: number, title: string, lines: string[]) => {
    let cy = headerY;
    const drawAt = (text: string, size: number, color: RGB) => {
      const runs = splitFontRuns(text, fontHe, fontLat);
      if (rtl) {
        let rx = x + colW;
        for (let i = runs.length - 1; i >= 0; i--) {
          const run = runs[i]!;
          const w = run.font.widthOfTextAtSize(run.text, size);
          rx -= w;
          page.drawText(run.text, { x: rx, y: cy - size, size, font: run.font, color });
        }
      } else {
        let lx = x;
        for (const run of runs) {
          page.drawText(run.text, { x: lx, y: cy - size, size, font: run.font, color });
          lx += run.font.widthOfTextAtSize(run.text, size);
        }
      }
      cy -= lh(size);
    };
    drawAt(title, 10, muted);
    for (const line of lines) {
      drawAt(line, 11, titleColor);
    }
    return cy;
  };

  const issuerEndY = drawPartyColumn(
    rtl ? rightX : leftX,
    rtl ? 'מנפיק' : 'Issuer',
    issuerLines,
  );
  const recipientEndY = drawPartyColumn(
    rtl ? leftX : rightX,
    rtl ? 'לכבוד' : 'Bill to',
    customerLines,
  );
  y = Math.min(issuerEndY, recipientEndY) - 16;

  const colDesc = rtl ? contentW * 0.45 : contentW * 0.45;
  const colQty = contentW * 0.12;
  const colUnit = contentW * 0.18;
  const colAmt = contentW * 0.25;

  const header = rtl
    ? ['תיאור', 'כמות', 'מחיר', 'סכום']
    : ['Description', 'Qty', 'Price', 'Amount'];
  drawLine(header.join('   '), 10, muted);
  y -= 4;
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.5,
    color: rgb(0.85, 0.87, 0.9),
  });
  y -= 10;

  for (const line of snapshot.lines) {
    newPageIfNeeded(margin + lh(10) + 20);
    const desc = line.description || '—';
    const qty = line.quantity != null ? String(line.quantity) : '—';
    const unit =
      line.unit_price_reference != null
        ? `${line.unit_price_reference.toFixed(2)} ${snapshot.document.currency}`
        : '—';
    const amt =
      line.amount_reference != null
        ? `${line.amount_reference.toFixed(2)} ${snapshot.document.currency}`
        : '—';
    const row = rtl ? `${amt}  ${unit}  ${qty}  ${desc}` : `${desc}  ${qty}  ${unit}  ${amt}`;
    drawLine(row, 10, titleColor);
  }

  y -= 8;
  const totalStr =
    snapshot.totals.subtotal_reference != null
      ? `${snapshot.totals.totals_label}: ${snapshot.totals.subtotal_reference.toFixed(2)} ${snapshot.totals.currency}`
      : `${snapshot.totals.totals_label}: —`;
  drawLine(totalStr, 12, accent);
  y -= 6;
  drawLine(
    rtl ? '(סכום תצוגה — אמת פיננסית ב-Accounting Base)' : '(Display total — financial truth in Accounting Base)',
    8,
    muted,
  );

  if (snapshot.notes) {
    y -= 12;
    drawLine(rtl ? 'הערות' : 'Notes', 10, muted);
    drawBlock([snapshot.notes], 10, titleColor);
  }

  y = margin + lh(8);
  drawLine(snapshot.footer_text ?? '', 8, muted);

  return Buffer.from(await pdfDoc.save());
}
