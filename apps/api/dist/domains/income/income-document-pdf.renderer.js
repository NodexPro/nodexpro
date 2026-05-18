/**
 * INC-6 — Server-side PDF renderer (pdf-lib + Noto Sans Hebrew). No browser dependency.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function resolveNotoWoffPaths() {
    const base = path.join(API_ROOT, 'node_modules/@fontsource/noto-sans-hebrew/files');
    const hebrew = path.join(base, 'noto-sans-hebrew-hebrew-400-normal.woff');
    const latin = path.join(base, 'noto-sans-hebrew-latin-400-normal.woff');
    if (!fs.existsSync(hebrew) || !fs.existsSync(latin)) {
        throw new Error('PDF fonts missing (install @fontsource/noto-sans-hebrew)');
    }
    return { hebrew, latin };
}
function isHebrewScriptCodePoint(cp) {
    return (cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f);
}
function fontForCodePoint(cp, he, lat) {
    return isHebrewScriptCodePoint(cp) ? he : lat;
}
function widthOfMixedText(text, size, he, lat) {
    let w = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        w += fontForCodePoint(cp, he, lat).widthOfTextAtSize(ch, size);
    }
    return w;
}
function splitFontRuns(text, he, lat) {
    const runs = [];
    let cur = '';
    let curF = null;
    for (const ch of text) {
        const f = fontForCodePoint(ch.codePointAt(0), he, lat);
        if (curF === null) {
            cur = ch;
            curF = f;
        }
        else if (f === curF) {
            cur += ch;
        }
        else {
            runs.push({ text: cur, font: curF });
            cur = ch;
            curF = f;
        }
    }
    if (cur && curF)
        runs.push({ text: cur, font: curF });
    return runs;
}
export async function renderIncomeDocumentPdfBuffer(snapshot) {
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
    const lh = (s) => s * 1.35;
    const newPageIfNeeded = (need) => {
        if (y >= need)
            return;
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
    };
    const drawLine = (text, size, color, bold = false) => {
        const runs = splitFontRuns(text, fontHe, fontLat);
        if (rtl) {
            let x = pageWidth - margin;
            for (let i = runs.length - 1; i >= 0; i--) {
                const run = runs[i];
                const w = run.font.widthOfTextAtSize(run.text, size);
                x -= w;
                page.drawText(run.text, { x, y: y - size, size, font: run.font, color });
            }
        }
        else {
            let x = margin;
            for (const run of runs) {
                page.drawText(run.text, { x, y: y - size, size, font: run.font, color });
                x += run.font.widthOfTextAtSize(run.text, size);
            }
        }
        y -= lh(size);
    };
    const drawBlock = (lines, size, color) => {
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
    drawLine(rtl
        ? `מס׳ ${snapshot.document.document_number} · ${snapshot.document.issue_date}`
        : `No. ${snapshot.document.document_number} · ${snapshot.document.issue_date}`, 11, muted);
    y -= 12;
    const issuerLines = [
        snapshot.issuer.legal_name,
        snapshot.issuer.tax_id ? (rtl ? `ע.מ/ח.פ: ${snapshot.issuer.tax_id}` : `Tax ID: ${snapshot.issuer.tax_id}`) : '',
        ...snapshot.issuer.address_lines,
    ].filter(Boolean);
    const customerLines = [
        snapshot.customer.display_name,
        snapshot.customer.tax_id ? (rtl ? `מזהה: ${snapshot.customer.tax_id}` : `ID: ${snapshot.customer.tax_id}`) : '',
        snapshot.customer.phone ?? '',
        snapshot.customer.email ?? '',
        ...snapshot.customer.address_lines,
    ].filter(Boolean);
    drawLine(rtl ? 'מנפיק' : 'Issuer', 10, muted);
    drawBlock(issuerLines, 11, titleColor);
    y -= 8;
    drawLine(rtl ? 'לקוח' : 'Customer', 10, muted);
    drawBlock(customerLines, 11, titleColor);
    y -= 16;
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
        const unit = line.unit_price_reference != null
            ? `${line.unit_price_reference.toFixed(2)} ${snapshot.document.currency}`
            : '—';
        const amt = line.amount_reference != null
            ? `${line.amount_reference.toFixed(2)} ${snapshot.document.currency}`
            : '—';
        const row = rtl ? `${amt}  ${unit}  ${qty}  ${desc}` : `${desc}  ${qty}  ${unit}  ${amt}`;
        drawLine(row, 10, titleColor);
    }
    y -= 8;
    const totalStr = snapshot.totals.subtotal_reference != null
        ? `${snapshot.totals.totals_label}: ${snapshot.totals.subtotal_reference.toFixed(2)} ${snapshot.totals.currency}`
        : `${snapshot.totals.totals_label}: —`;
    drawLine(totalStr, 12, accent);
    y -= 6;
    drawLine(rtl ? '(סכום תצוגה — אמת פיננסית ב-Accounting Base)' : '(Display total — financial truth in Accounting Base)', 8, muted);
    if (snapshot.notes) {
        y -= 12;
        drawLine(rtl ? 'הערות' : 'Notes', 10, muted);
        drawBlock([snapshot.notes], 10, titleColor);
    }
    y = margin + lh(8);
    drawLine(snapshot.footer_text ?? '', 8, muted);
    return Buffer.from(await pdfDoc.save());
}
